import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import {
  type Component,
  COMPONENTS,
  dateOnlyToDate,
  dateToDateOnly,
  ErrorCode,
  FIELD_KEYS,
  type FieldKey,
  IMPORT_MAX_BYTES,
  type ImportCommitResult,
  type ImportIssue,
  type ImportPreview,
} from '@siseep/shared';
import type { ClientSession, Connection, Model, Types } from 'mongoose';
import { Activity } from '../activities/activity.schema';
import { Grade } from '../activities/grade.schema';
import { AppException, Errors } from '../common/app.exception';
import type { Actor } from '../common/request-user';
import { assertCan, oid } from '../common/scope';
import { Group, type GroupDocument } from '../groups/group.schema';
import { PeriodResult } from '../period-results/period-result.schema';
import { PeriodStatusService } from '../periods/period-status.service';
import { Period, type PeriodDocument } from '../periods/period.schema';
import { SchoolYear } from '../school-years/school-year.schema';
import { Enrollment } from '../students/enrollment.schema';
import { normalizeName, searchNameOf, Student } from '../students/student.schema';
import { SummaryCache } from '../summary/summary-cache.service';
import {
  type ParsedWorkbook,
  parseWorkbook,
  resolveLooseDate,
  WorkbookReadError,
} from './excel-parser';
import {
  type ImportPayload,
  type ImportPreviewDocument,
  ImportPreviewRecord,
} from './import-preview.schema';

const PREVIEW_TTL_MS = 60 * 60 * 1000;
const ROMAN = ['', 'i', 'ii', 'iii'];
const ORDINAL = ['', 'primer', 'segundo', 'tercer'];

@Injectable()
export class ImportsService {
  constructor(
    @InjectModel(ImportPreviewRecord.name)
    private readonly previewModel: Model<ImportPreviewRecord>,
    @InjectModel(Group.name) private readonly groupModel: Model<Group>,
    @InjectModel(Period.name) private readonly periodModel: Model<Period>,
    @InjectModel(SchoolYear.name) private readonly yearModel: Model<SchoolYear>,
    @InjectModel(Student.name) private readonly studentModel: Model<Student>,
    @InjectModel(Enrollment.name) private readonly enrollmentModel: Model<Enrollment>,
    @InjectModel(Activity.name) private readonly activityModel: Model<Activity>,
    @InjectModel(Grade.name) private readonly gradeModel: Model<Grade>,
    @InjectModel(PeriodResult.name) private readonly resultModel: Model<PeriodResult>,
    @InjectConnection() private readonly connection: Connection,
    private readonly summaryCache: SummaryCache,
    private readonly periodStatus: PeriodStatusService,
  ) {}

  // -------------------------------------------------------------------------
  // Preview
  // -------------------------------------------------------------------------
  async preview(
    file: { buffer: Buffer; size: number; originalname: string } | undefined,
    groupId: string,
    periodId: string,
    actor: Actor,
  ): Promise<ImportPreview> {
    if (!file) throw Errors.invalidFile('Elige el archivo de Excel (.xlsx).');
    if (file.size > IMPORT_MAX_BYTES) throw Errors.invalidFile('El archivo pesa más de 15 MB.');
    // .xlsx files are ZIP archives: they start with "PK".
    if (file.buffer.subarray(0, 2).toString('latin1') !== 'PK') {
      throw Errors.invalidFile('El archivo debe ser un Excel .xlsx (no .xls ni .csv).');
    }
    const { group, period } = await this.loadTarget(groupId, periodId, actor);
    const year = await this.yearModel.findById(group.schoolYearId).lean().exec();

    let parsed;
    try {
      parsed = await parseWorkbook(file.buffer);
    } catch (error) {
      if (error instanceof WorkbookReadError) throw Errors.invalidFile(error.message);
      throw error;
    }
    const issues: ImportIssue[] = [...parsed.issues];
    this.checkMeta(parsed.meta, group, period, year?.name, issues);

    // Dates: inside the school year; missing ones take the period start date.
    const startYear = year ? year.startDate.getUTCFullYear() : new Date().getUTCFullYear();
    const fallback = dateToDateOnly(period.startDate);
    const activities = parsed.activities.map(({ date, ...rest }) => {
      const resolved = resolveLooseDate(date, startYear, fallback);
      if (resolved.quality !== 'exact') {
        issues.push({
          severity: 'warning',
          code: resolved.quality === 'missing' ? 'MISSING_DATE' : 'INCOMPLETE_DATE',
          sheet: rest.sheet,
          cell: `${rest.column}4`,
          message:
            resolved.quality === 'missing'
              ? `${rest.sheet} / "${rest.name}" no tiene fecha${rest.dateText ? ` legible ("${rest.dateText}")` : ''}; se usará el inicio del periodo (${resolved.date}).`
              : `${rest.sheet} / "${rest.name}": la fecha "${rest.dateText}" no tiene día; se usará ${resolved.date}.`,
        });
      }
      return { ...rest, date: resolved.date };
    });

    const students = await this.matchStudents(parsed.students, group, issues);
    const payload: ImportPayload = {
      students,
      activities,
      adjustments: parsed.adjustments,
      observations: parsed.observations,
    };
    const blocked = issues.some((i) => i.blocking);
    const record = await this.previewModel.create({
      schoolId: actor.user.schoolId,
      groupId: group._id,
      periodId: period._id,
      fileName: file.originalname.slice(0, 200),
      payload,
      issues,
      blocked,
      createdBy: actor.user.id,
      expiresAt: new Date(Date.now() + PREVIEW_TTL_MS),
    });
    return this.toPreview(record, group, period);
  }

  /** Students: reuse the one already enrolled with that N/L, or an existing one by name. */
  private async matchStudents(
    parsed: ParsedWorkbook['students'],
    group: GroupDocument,
    issues: ImportIssue[],
  ): Promise<ImportPayload['students']> {
    const enrollments = await this.enrollmentModel
      .find({ groupId: group._id, status: 'ACTIVE' })
      .lean()
      .exec();
    const enrolledStudents = await this.studentModel
      .find({ _id: { $in: enrollments.map((e) => e.studentId) } })
      .lean()
      .exec();
    const byId = new Map(enrolledStudents.map((s) => [s._id.toString(), s]));
    const byListNumber = new Map(
      enrollments.map((e) => [e.listNumber, byId.get(e.studentId.toString())]),
    );
    const sameYear = await this.enrollmentModel
      .find({ schoolYearId: group.schoolYearId, groupId: { $ne: group._id } })
      .lean()
      .exec();
    const enrolledElsewhere = new Set(sameYear.map((e) => e.studentId.toString()));

    const result: ImportPayload['students'] = [];
    for (const student of parsed) {
      const searchName = searchNameOf(student);
      const atNumber = byListNumber.get(student.listNumber);
      if (atNumber) {
        if (atNumber.searchName === searchName) {
          issues.push({
            severity: 'info',
            code: 'ALREADY_ENROLLED',
            listNumber: student.listNumber,
            message: `N/L ${student.listNumber} ${student.fullName} ya está en el grupo: se actualizan sus datos del periodo.`,
          });
          result.push({ ...student, status: 'enrolled', studentId: atNumber._id.toString() });
        } else {
          issues.push({
            severity: 'error',
            code: 'LIST_NUMBER_TAKEN',
            blocking: true,
            listNumber: student.listNumber,
            message: `El N/L ${student.listNumber} del grupo ya es de "${[atNumber.lastName1, atNumber.lastName2, atNumber.firstName].filter(Boolean).join(' ')}", no de "${student.fullName}". Corrige la lista o la inscripción antes de importar.`,
          });
          result.push({ ...student, status: 'enrolled', studentId: atNumber._id.toString() });
        }
        continue;
      }

      const sameName = await this.studentModel
        .find({ schoolId: group.schoolId, searchName, deletedAt: null })
        .lean()
        .exec();
      const existing = sameName[0];
      if (existing) {
        if (enrolledElsewhere.has(existing._id.toString())) {
          issues.push({
            severity: 'error',
            code: 'ENROLLED_IN_OTHER_GROUP',
            blocking: true,
            listNumber: student.listNumber,
            message: `"${student.fullName}" ya está inscrito en otro grupo de este ciclo.`,
          });
        } else {
          issues.push({
            severity: 'warning',
            code: 'NAME_EXISTS',
            listNumber: student.listNumber,
            message: `Ya existe un alumno llamado "${student.fullName}"${sameName.length > 1 ? ` (${sameName.length} registros)` : ''}: se usará ese registro y se inscribirá en el grupo.`,
          });
        }
        result.push({ ...student, status: 'existing', studentId: existing._id.toString() });
        continue;
      }
      result.push({ ...student, status: 'new' });
    }
    return result;
  }

  /** Compares the "Datos" sheet with the group and period chosen in the screen. */
  private checkMeta(
    meta: { group?: string; schoolYear?: string; period?: string },
    group: GroupDocument,
    period: PeriodDocument,
    yearName: string | undefined,
    issues: ImportIssue[],
  ): void {
    const squash = (s: string) => normalizeName(s).replace(/[\s°º]/g, '');
    if (meta.group && squash(meta.group) !== squash(group.name)) {
      issues.push({
        severity: 'warning',
        code: 'GROUP_MISMATCH',
        sheet: 'Datos',
        message: `El Excel dice grupo "${meta.group}" y elegiste ${group.name}.`,
      });
    }
    if (meta.schoolYear && yearName && squash(meta.schoolYear) !== squash(yearName)) {
      issues.push({
        severity: 'warning',
        code: 'SCHOOL_YEAR_MISMATCH',
        sheet: 'Datos',
        message: `El Excel dice ciclo "${meta.schoolYear}" y el grupo es del ciclo ${yearName}.`,
      });
    }
    if (meta.period) {
      const words = normalizeName(meta.period).split(' ');
      const matches =
        words.includes(String(period.number)) ||
        words.includes(ROMAN[period.number]!) ||
        words.includes(ORDINAL[period.number]!) ||
        words.includes(`${ORDINAL[period.number]}o`);
      if (!matches) {
        issues.push({
          severity: 'warning',
          code: 'PERIOD_MISMATCH',
          sheet: 'Datos',
          message: `El Excel dice "${meta.period}" y elegiste el periodo ${period.number} (${period.name}).`,
        });
      }
    }
  }

  // -------------------------------------------------------------------------
  // Commit
  // -------------------------------------------------------------------------
  /**
   * Imports what the preview showed, in a single transaction. Idempotent: activities are matched
   * by group + period + field + component + name, grades by activity + student, and period
   * results by period + student, so importing the same file again changes nothing.
   */
  async commit(previewId: string, actor: Actor): Promise<ImportCommitResult> {
    const preview = await this.previewModel
      .findOne({ _id: previewId, schoolId: actor.user.schoolId, expiresAt: { $gt: new Date() } })
      .exec();
    if (!preview) {
      throw new AppException(
        HttpStatus.GONE,
        ErrorCode.IMPORT_EXPIRED,
        'La vista previa ya no está disponible (dura 1 hora). Vuelve a subir el archivo.',
      );
    }
    if (preview.blocked) {
      throw new AppException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        ErrorCode.IMPORT_BLOCKED,
        'Hay errores que impiden importar. Corrige el Excel y vuelve a subirlo.',
        preview.issues.filter((i) => i.blocking),
      );
    }
    const { group, period } = await this.loadTarget(
      preview.groupId.toString(),
      preview.periodId.toString(),
      actor,
    );

    const result: ImportCommitResult = {
      studentsCreated: 0,
      studentsReused: 0,
      enrollmentsCreated: 0,
      activitiesCreated: 0,
      activitiesUpdated: 0,
      gradesUpserted: 0,
      periodResultsUpserted: 0,
    };

    await this.connection.transaction(async (session) => {
      // Reset counters if the driver retries the transaction.
      Object.keys(result).forEach((k) => (result[k as keyof ImportCommitResult] = 0));
      const studentIds = await this.commitStudents(preview, group, actor, session, result);
      await this.commitActivities(preview, group, period, studentIds, actor, session, result);
      await this.commitPeriodResults(preview, group, period, studentIds, session, result);
      preview.committedAt = new Date();
      await preview.save({ session });
    });
    this.summaryCache.invalidateGroup(group._id.toString());
    return result;
  }

  private async commitStudents(
    preview: ImportPreviewDocument,
    group: GroupDocument,
    actor: Actor,
    session: ClientSession,
    result: ImportCommitResult,
  ): Promise<Map<number, Types.ObjectId>> {
    const ids = new Map<number, Types.ObjectId>();
    for (const s of preview.payload.students) {
      // Enrolled with this N/L already (e.g. second import) → same student.
      const enrolled = await this.enrollmentModel
        .findOne({ groupId: group._id, listNumber: s.listNumber, status: 'ACTIVE' }, null, {
          session,
        })
        .exec();
      if (enrolled) {
        ids.set(s.listNumber, enrolled.studentId);
        result.studentsReused++;
        continue;
      }
      let studentId: Types.ObjectId;
      const existing = s.studentId
        ? await this.studentModel
            .findOne({ _id: s.studentId, schoolId: group.schoolId }, null, { session })
            .exec()
        : await this.studentModel
            .findOne(
              { schoolId: group.schoolId, searchName: searchNameOf(s), deletedAt: null },
              null,
              { session },
            )
            .exec();
      if (existing) {
        studentId = existing._id;
        result.studentsReused++;
      } else {
        const [created] = await this.studentModel.create(
          [
            {
              schoolId: group.schoolId,
              firstName: s.firstName,
              lastName1: s.lastName1,
              lastName2: s.lastName2,
              searchName: searchNameOf(s),
              createdBy: actor.user.id,
            },
          ],
          { session },
        );
        studentId = created!._id;
        result.studentsCreated++;
      }
      await this.enrollmentModel.create(
        [
          {
            schoolId: group.schoolId,
            studentId,
            groupId: group._id,
            schoolYearId: group.schoolYearId,
            listNumber: s.listNumber,
            from: new Date(),
            createdBy: actor.user.id,
          },
        ],
        { session },
      );
      result.enrollmentsCreated++;
      ids.set(s.listNumber, studentId);
    }
    return ids;
  }

  private async commitActivities(
    preview: ImportPreviewDocument,
    group: GroupDocument,
    period: PeriodDocument,
    studentIds: Map<number, Types.ObjectId>,
    actor: Actor,
    session: ClientSession,
    result: ImportCommitResult,
  ): Promise<void> {
    const now = new Date();
    for (const a of preview.payload.activities) {
      const key = {
        schoolId: group.schoolId,
        groupId: group._id,
        periodId: period._id,
        fieldKey: a.fieldKey,
        component: a.component,
        name: a.name,
        deletedAt: null,
      };
      const res = await this.activityModel
        .findOneAndUpdate(
          key,
          {
            $set: {
              date: dateOnlyToDate(a.date),
              dateText: a.dateText ?? null,
              subjectKey: a.subjectKey ?? null,
            },
            $setOnInsert: {
              visibleToGuardians: true,
              visibleFrom: now,
              createdBy: oid(actor.user.id),
            },
          },
          { upsert: true, new: true, session, includeResultMetadata: true },
        )
        .exec();
      const activity = res.value!;
      if (res.lastErrorObject?.updatedExisting) result.activitiesUpdated++;
      else result.activitiesCreated++;

      const ops = a.grades
        .filter((g) => studentIds.has(g.listNumber))
        .map((g) => ({
          updateOne: {
            filter: { activityId: activity._id, studentId: studentIds.get(g.listNumber)! },
            update: {
              $set: {
                schoolId: group.schoolId,
                groupId: group._id,
                periodId: period._id,
                fieldKey: a.fieldKey,
                component: a.component,
                subjectKey: a.subjectKey ?? null,
                status: g.status,
                score: g.score,
                updatedBy: oid(actor.user.id),
              },
            },
            upsert: true,
          },
        }));
      if (ops.length) {
        await this.gradeModel.bulkWrite(ops, { session });
        result.gradesUpserted += ops.length;
      }
    }
  }

  private async commitPeriodResults(
    preview: ImportPreviewDocument,
    group: GroupDocument,
    period: PeriodDocument,
    studentIds: Map<number, Types.ObjectId>,
    session: ClientSession,
    result: ImportCommitResult,
  ): Promise<void> {
    const { adjustments, observations } = preview.payload;
    const listNumbers = new Set([
      ...adjustments.map((a) => a.listNumber),
      ...observations.map((o) => o.listNumber),
    ]);
    const ops = [...listNumbers]
      .filter((n) => studentIds.has(n))
      .map((listNumber) => {
        const obs = observations.find((o) => o.listNumber === listNumber);
        const fields = FIELD_KEYS.map((fieldKey) => ({
          fieldKey,
          override:
            adjustments.find((a) => a.listNumber === listNumber && a.fieldKey === fieldKey)
              ?.value ?? null,
        }));
        return {
          updateOne: {
            filter: { periodId: period._id, studentId: studentIds.get(listNumber)! },
            update: {
              $set: {
                schoolId: group.schoolId,
                groupId: group._id,
                fields,
                observations: { general: obs?.general ?? null, byField: obs?.byField ?? {} },
                legendOverride: obs?.legendOverride ?? null,
              },
            },
            upsert: true,
          },
        };
      });
    if (ops.length) {
      await this.resultModel.bulkWrite(ops, { session });
      result.periodResultsUpserted = ops.length;
    }
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------
  private async loadTarget(
    groupId: string,
    periodId: string,
    actor: Actor,
  ): Promise<{ group: GroupDocument; period: PeriodDocument }> {
    const schoolId = actor.user.schoolId;
    const [group, period] = await Promise.all([
      this.groupModel.findOne({ _id: groupId, schoolId, deletedAt: null }).exec(),
      this.periodModel.findOne({ _id: periodId, schoolId }).exec(),
    ]);
    if (!group) throw Errors.notFound('El grupo no existe.');
    if (!period) throw Errors.notFound('El periodo no existe.');
    assertCan(actor.ability, 'create', 'Import', { schoolId, groupId: group._id });
    if (!period.schoolYearId.equals(group.schoolYearId)) {
      throw Errors.badRequest('El periodo no pertenece al ciclo escolar del grupo.');
    }
    await this.periodStatus.assertOpen(period._id, group._id);
    return { group, period };
  }

  private toPreview(
    record: ImportPreviewDocument,
    group: GroupDocument,
    period: PeriodDocument,
  ): ImportPreview {
    const { payload, issues } = record;
    const activitiesByField = Object.fromEntries(
      FIELD_KEYS.map((f) => [f, Object.fromEntries(COMPONENTS.map((c) => [c, 0]))]),
    ) as Record<FieldKey, Record<Component, number>>;
    for (const a of payload.activities) activitiesByField[a.fieldKey][a.component]++;
    const count = (status: string) => payload.students.filter((s) => s.status === status).length;
    return {
      previewId: record._id.toString(),
      expiresAt: record.expiresAt.toISOString(),
      fileName: record.fileName,
      group: { id: group._id.toString(), name: group.name },
      period: { id: period._id.toString(), name: period.name },
      summary: {
        students: {
          total: payload.students.length,
          new: count('new'),
          existing: count('existing'),
          enrolled: count('enrolled'),
        },
        activitiesByField,
        activities: payload.activities.length,
        grades: payload.activities.reduce((n, a) => n + a.grades.length, 0),
        adjustments: payload.adjustments.length,
        observations: payload.observations.length,
        errors: issues.filter((i) => i.severity === 'error').length,
        warnings: issues.filter((i) => i.severity === 'warning').length,
      },
      canCommit: !record.blocked,
      students: payload.students.map(({ studentId: _studentId, ...s }) => s),
      activities: payload.activities.map((a) => ({
        fieldKey: a.fieldKey,
        component: a.component,
        ...(a.subjectKey ? { subjectKey: a.subjectKey } : {}),
        name: a.name,
        date: a.date,
        ...(a.dateText ? { dateText: a.dateText } : {}),
        sheet: a.sheet,
        column: a.column,
        gradeCount: a.grades.length,
        notDeliveredCount: a.grades.filter((g) => g.status === 'NOT_DELIVERED').length,
        pendingCount: a.pending.length,
      })),
      issues,
    };
  }
}
