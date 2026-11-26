import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import {
  type ActivityGradesView,
  ErrorCode,
  FIELD_KEYS,
  type GradeConflict,
  type GradeEntry,
  type GradeRow,
  type GradeValue,
  type SaveGradesResult,
  shortStudentName,
  type StudentGradesView,
} from '@siseep/shared';
import type { Connection, Model, Types } from 'mongoose';
import { AuditService } from '../audit/audit.service';
import { AppException, Errors } from '../common/app.exception';
import type { Actor } from '../common/request-user';
import { assertCan, oid, scopedQuery, studentFullName } from '../common/scope';
import { Group } from '../groups/group.schema';
import { GroupsService } from '../groups/groups.service';
import { Period } from '../periods/period.schema';
import { Enrollment } from '../students/enrollment.schema';
import { Student } from '../students/student.schema';
import { SummaryCache } from '../summary/summary-cache.service';
import { ActivitiesService } from './activities.service';
import { Activity } from './activity.schema';
import { Grade } from './grade.schema';

type StoredGrade = {
  studentId: Types.ObjectId;
  status: GradeValue['status'];
  score?: number | null;
  comment?: string | null;
  updatedAt: Date;
};

const toValue = (g: StoredGrade): GradeValue => ({
  status: g.status,
  score: g.score ?? null,
  comment: g.comment ?? null,
  updatedAt: g.updatedAt.toISOString(),
});

const same = (g: StoredGrade, entry: GradeEntry) =>
  g.status === entry.status &&
  (g.score ?? null) === entry.score &&
  (g.comment ?? null) === entry.comment;

@Injectable()
export class GradesService {
  constructor(
    @InjectModel(Grade.name) private readonly gradeModel: Model<Grade>,
    @InjectModel(Activity.name) private readonly activityModel: Model<Activity>,
    @InjectModel(Enrollment.name) private readonly enrollmentModel: Model<Enrollment>,
    @InjectModel(Student.name) private readonly studentModel: Model<Student>,
    @InjectModel(Group.name) private readonly groupModel: Model<Group>,
    @InjectModel(Period.name) private readonly periodModel: Model<Period>,
    @InjectConnection() private readonly connection: Connection,
    private readonly activities: ActivitiesService,
    private readonly groups: GroupsService,
    private readonly audit: AuditService,
    private readonly summaryCache: SummaryCache,
  ) {}

  /** The group's active list by N/L with each student's grade (or null) in this activity. */
  async forActivity(activityId: string, actor: Actor): Promise<ActivityGradesView> {
    const activity = await this.activities.load(activityId, actor);
    const [view, group, period, enrollments, grades] = await Promise.all([
      this.activities.get(activityId, actor),
      this.groupModel.findById(activity.groupId, { name: 1 }).lean().exec(),
      this.periodModel.findById(activity.periodId, { status: 1 }).lean().exec(),
      this.enrollmentModel
        .find({ groupId: activity.groupId, status: 'ACTIVE' })
        .sort({ listNumber: 1 })
        .lean()
        .exec(),
      this.gradeModel.find({ activityId: activity._id }).lean<StoredGrade[]>().exec(),
    ]);
    const students = await this.studentModel
      .find({ _id: { $in: enrollments.map((e) => e.studentId) } })
      .lean()
      .exec();
    const studentBy = new Map(students.map((s) => [s._id.toString(), s]));
    const gradeBy = new Map(grades.map((g) => [g.studentId.toString(), g]));

    const rows: GradeRow[] = enrollments.flatMap((e) => {
      const s = studentBy.get(e.studentId.toString());
      if (!s) return [];
      const grade = gradeBy.get(e.studentId.toString());
      return [
        {
          student: {
            id: s._id.toString(),
            listNumber: e.listNumber,
            fullName: studentFullName(s),
            shortName: shortStudentName(s),
          },
          grade: grade ? toValue(grade) : null,
        },
      ];
    });
    return {
      activity: view,
      groupName: group?.name ?? '',
      periodStatus: period?.status ?? '',
      rows,
    };
  }

  /**
   * Saves a batch in one transaction (upsert by activity + student). Rows equal to what is stored
   * are skipped. If a row's `expectedUpdatedAt` does not match, nothing is saved and a 409 lists
   * the current values.
   */
  async save(activityId: string, entries: GradeEntry[], actor: Actor): Promise<SaveGradesResult> {
    const activity = await this.activities.load(activityId, actor);
    assertCan(actor.ability, 'update', 'Grade', {
      schoolId: activity.schoolId,
      groupId: activity.groupId,
      subjectKey: activity.subjectKey ?? null,
    });
    await this.activities.assertPeriodOpen(activity.periodId);

    // Every student must be active in the activity's group.
    const studentIds = entries.map((e) => oid(e.studentId));
    const enrolled = await this.enrollmentModel
      .find(
        { groupId: activity.groupId, status: 'ACTIVE', studentId: { $in: studentIds } },
        { studentId: 1 },
      )
      .lean()
      .exec();
    const enrolledIds = new Set(enrolled.map((e) => e.studentId.toString()));
    const invalid = entries.filter((e) => !enrolledIds.has(e.studentId)).map((e) => e.studentId);
    if (invalid.length) {
      throw new AppException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        ErrorCode.INVALID_STUDENTS,
        'Hay alumnos que no están inscritos en este grupo.',
        invalid.map((studentId) => ({ studentId })),
      );
    }

    let saved: StoredGrade[] = [];
    await this.connection.transaction(async (session) => {
      const existing = await this.gradeModel
        .find({ activityId: activity._id, studentId: { $in: studentIds } }, null, { session })
        .lean<StoredGrade[]>()
        .exec();
      const existingBy = new Map(existing.map((g) => [g.studentId.toString(), g]));

      const conflicts: GradeConflict[] = [];
      for (const entry of entries) {
        if (entry.expectedUpdatedAt === undefined) continue;
        const current = existingBy.get(entry.studentId);
        const currentVersion = current ? current.updatedAt.toISOString() : null;
        const expected = entry.expectedUpdatedAt
          ? new Date(entry.expectedUpdatedAt).toISOString()
          : null;
        if (currentVersion !== expected) {
          conflicts.push({
            studentId: entry.studentId,
            current: current ? toValue(current) : null,
          });
        }
      }
      if (conflicts.length) {
        throw new AppException(
          HttpStatus.CONFLICT,
          ErrorCode.GRADE_CONFLICT,
          'Alguien más cambió estas calificaciones mientras capturabas. Revisa los valores actuales.',
          conflicts,
        );
      }

      const changed = entries.filter((e) => {
        const current = existingBy.get(e.studentId);
        return !current || !same(current, e);
      });
      if (changed.length) {
        await this.gradeModel.bulkWrite(
          changed.map((e) => ({
            updateOne: {
              filter: { activityId: activity._id, studentId: oid(e.studentId) },
              update: {
                $set: {
                  schoolId: activity.schoolId,
                  groupId: activity.groupId,
                  periodId: activity.periodId,
                  fieldKey: activity.fieldKey,
                  component: activity.component,
                  subjectKey: activity.subjectKey ?? null,
                  status: e.status,
                  score: e.score,
                  comment: e.comment,
                  updatedBy: oid(actor.user.id),
                },
              },
              upsert: true,
            },
          })),
          { session },
        );
        const written = await this.gradeModel
          .find(
            { activityId: activity._id, studentId: { $in: changed.map((e) => oid(e.studentId)) } },
            null,
            { session },
          )
          .lean<(StoredGrade & { _id: Types.ObjectId })[]>()
          .exec();
        await this.audit.record(
          actor,
          written.map((g) => {
            const before = existingBy.get(g.studentId.toString());
            return {
              action: before ? ('update' as const) : ('create' as const),
              entity: 'grade' as const,
              entityId: g._id,
              groupId: activity.groupId,
              subjectKey: activity.subjectKey ?? null,
              before: before
                ? {
                    activityId: activity._id.toString(),
                    studentId: g.studentId.toString(),
                    status: before.status,
                    score: before.score ?? null,
                    comment: before.comment ?? null,
                  }
                : null,
              after: {
                activityId: activity._id.toString(),
                studentId: g.studentId.toString(),
                status: g.status,
                score: g.score ?? null,
                comment: g.comment ?? null,
              },
            };
          }),
          session,
        );
      }
      saved = await this.gradeModel
        .find({ activityId: activity._id, studentId: { $in: studentIds } }, null, { session })
        .lean<StoredGrade[]>()
        .exec();
    });

    // The live summary of the group changed.
    this.summaryCache.invalidateGroup(activity.groupId.toString());
    return { saved: saved.map((g) => ({ studentId: g.studentId.toString(), ...toValue(g) })) };
  }

  /** Student file: their grades of the period by field (scoped: subject teachers see their subject). */
  async forStudent(studentId: string, periodId: string, actor: Actor): Promise<StudentGradesView> {
    const student = await this.studentModel
      .findOne({ _id: studentId, schoolId: actor.user.schoolId, deletedAt: null })
      .lean()
      .exec();
    if (!student) throw Errors.notFound('El alumno no existe.');
    const period = await this.periodModel
      .findOne({ _id: periodId, schoolId: actor.user.schoolId })
      .lean()
      .exec();
    if (!period) throw Errors.notFound('El periodo no existe.');
    const enrollment = await this.enrollmentModel
      .findOne({ studentId: student._id, schoolYearId: period.schoolYearId })
      .lean()
      .exec();
    if (!enrollment) throw Errors.notFound('El alumno no está inscrito en ese ciclo.');
    const group = await this.groups.load(enrollment.groupId.toString(), actor);

    const scope = scopedQuery(actor, 'Activity');
    if (!scope) throw Errors.forbidden();
    const activities = await this.activityModel
      .find({ $and: [scope, { groupId: group._id, periodId: period._id, deletedAt: null }] })
      .sort({ component: 1, date: 1, name: 1 })
      .lean()
      .exec();
    const grades = await this.gradeModel
      .find({ studentId: student._id, activityId: { $in: activities.map((a) => a._id) } })
      .lean<(StoredGrade & { activityId: Types.ObjectId })[]>()
      .exec();
    const gradeBy = new Map(grades.map((g) => [g.activityId.toString(), g]));

    return {
      student: {
        id: student._id.toString(),
        fullName: studentFullName(student),
        listNumber: enrollment.listNumber,
        groupId: group._id.toString(),
        groupName: group.name,
      },
      periodId: period._id.toString(),
      fields: FIELD_KEYS.map((fieldKey) => ({
        fieldKey,
        activities: activities
          .filter((a) => a.fieldKey === fieldKey)
          .map((a) => {
            const grade = gradeBy.get(a._id.toString());
            return {
              id: a._id.toString(),
              name: a.name,
              component: a.component,
              ...(a.subjectKey ? { subjectKey: a.subjectKey } : {}),
              date: a.date.toISOString().slice(0, 10),
              grade: grade ? toValue(grade) : null,
            };
          }),
      })).filter((f) => f.activities.length > 0),
    };
  }
}
