import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  type ChildActivity,
  type ChildNote,
  type ChildOverview,
  type ChildPeriod,
  type ChildReportCard,
  type ChildView,
  dateToDateOnly,
  type EngineActivity,
  type EngineGrade,
  FIELD_NAMES,
  FIELD_SHORT_NAMES,
  type FieldKey,
  type HistoryPeriod,
  roundTo,
  shortStudentName,
  type StudentHistory,
  studentPeriodResult,
} from '@siseep/shared';
import type { Model, Types } from 'mongoose';
import { Activity } from '../activities/activity.schema';
import { Grade } from '../activities/grade.schema';
import { historyFields, HistoryService } from '../closing/history.service';
import { Errors } from '../common/app.exception';
import type { Actor } from '../common/request-user';
import { oid, studentFullName, teacherSummary } from '../common/scope';
import { Group, type GroupDocument } from '../groups/group.schema';
import { StudentNote } from '../notes/student-note.schema';
import { PeriodResult } from '../period-results/period-result.schema';
import { PeriodStatusService } from '../periods/period-status.service';
import { Period, type PeriodDocument } from '../periods/period.schema';
import { ReportCardsService, type ReportFile } from '../reports/report-cards.service';
import { SchoolYear } from '../school-years/school-year.schema';
import { Enrollment } from '../students/enrollment.schema';
import { Student } from '../students/student.schema';
import { PeriodDataService } from '../summary/period-data.service';
import { User } from '../users/user.schema';
import { GuardianLink } from './guardian-link.schema';

const DAY_MS = 24 * 60 * 60 * 1000;
type Person = { _id: Types.ObjectId; firstName: string; lastName?: string; email: string };

/** "Saberes", "Saberes y Ética", "Lenguajes, Saberes y Ética". */
function joinNames(names: string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} y ${names.at(-1)}`;
}

/** Monday 00:00 UTC of the week that contains `date`. */
function mondayOf(date: Date): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  return new Date(d.getTime() - (day - 1) * DAY_MS);
}

/**
 * Guardian portal (stage 5). Every method first checks an ACTIVE guardianLink of the signed-in
 * user and answers 404 otherwise, so a guardian cannot even learn that another student exists.
 * Only this student's data leaves this service: no group averages, no classmates.
 */
@Injectable()
export class GuardianPortalService {
  constructor(
    @InjectModel(GuardianLink.name) private readonly linkModel: Model<GuardianLink>,
    @InjectModel(Student.name) private readonly studentModel: Model<Student>,
    @InjectModel(Enrollment.name) private readonly enrollmentModel: Model<Enrollment>,
    @InjectModel(Group.name) private readonly groupModel: Model<Group>,
    @InjectModel(Period.name) private readonly periodModel: Model<Period>,
    @InjectModel(SchoolYear.name) private readonly yearModel: Model<SchoolYear>,
    @InjectModel(Activity.name) private readonly activityModel: Model<Activity>,
    @InjectModel(Grade.name) private readonly gradeModel: Model<Grade>,
    @InjectModel(StudentNote.name) private readonly noteModel: Model<StudentNote>,
    @InjectModel(PeriodResult.name) private readonly resultModel: Model<PeriodResult>,
    @InjectModel(User.name) private readonly userModel: Model<User>,
    private readonly periodStatus: PeriodStatusService,
    private readonly periodData: PeriodDataService,
    private readonly cards: ReportCardsService,
    private readonly historyService: HistoryService,
  ) {}

  private notFound() {
    return Errors.notFound('No encontramos a este alumno.');
  }

  /** The active link of this guardian with this student, or 404. */
  private async link(studentId: string, actor: Actor) {
    if (!/^[a-f\d]{24}$/i.test(studentId)) throw this.notFound();
    const link = await this.linkModel
      .findOne({
        guardianUserId: oid(actor.user.id),
        studentId: oid(studentId),
        schoolId: oid(actor.user.schoolId),
        status: 'ACTIVE',
      })
      .lean()
      .exec();
    if (!link) throw this.notFound();
    return link;
  }

  /** The child's group in the period's school year (404 for periods of other years). */
  private async target(
    studentId: string,
    periodId: string,
    actor: Actor,
  ): Promise<{ group: GroupDocument; period: PeriodDocument }> {
    await this.link(studentId, actor);
    if (!/^[a-f\d]{24}$/i.test(periodId)) throw Errors.notFound('El periodo no existe.');
    const period = await this.periodModel
      .findOne({ _id: oid(periodId), schoolId: oid(actor.user.schoolId) })
      .exec();
    if (!period) throw Errors.notFound('El periodo no existe.');
    const enrollment = await this.enrollmentModel
      .findOne({ studentId: oid(studentId), schoolYearId: period.schoolYearId })
      .lean()
      .exec();
    if (!enrollment) throw Errors.notFound('El periodo no existe.');
    const group = await this.groupModel.findById(enrollment.groupId).exec();
    if (!group) throw Errors.notFound('El periodo no existe.');
    return { group, period };
  }

  /** Activities a guardian may see: marked visible and already past `visibleFrom`. */
  private visibleActivities(groupId: Types.ObjectId, periodId: Types.ObjectId) {
    return this.activityModel
      .find({
        groupId,
        periodId,
        deletedAt: null,
        visibleToGuardians: true,
        visibleFrom: { $lte: new Date() },
      })
      .sort({ date: 1, createdAt: 1 })
      .lean()
      .exec();
  }

  // ---- endpoints ---------------------------------------------------------------------
  async children(actor: Actor): Promise<ChildView[]> {
    const links = await this.linkModel
      .find({
        guardianUserId: oid(actor.user.id),
        schoolId: oid(actor.user.schoolId),
        status: 'ACTIVE',
      })
      .sort({ createdAt: 1 })
      .lean()
      .exec();
    if (links.length === 0) return [];
    const studentIds = links.map((l) => l.studentId);
    const [students, enrollments, currentYear] = await Promise.all([
      this.studentModel
        .find({ _id: { $in: studentIds }, deletedAt: null })
        .lean()
        .exec(),
      this.enrollmentModel
        .find({ studentId: { $in: studentIds } })
        .sort({ from: -1 })
        .lean()
        .exec(),
      this.yearModel
        .findOne({ schoolId: oid(actor.user.schoolId), isCurrent: true })
        .lean()
        .exec(),
    ]);
    const today = new Date();
    const views: ChildView[] = [];
    for (const link of links) {
      const student = students.find((s) => s._id.equals(link.studentId));
      if (!student) continue;
      const own = enrollments.filter((e) => e.studentId.equals(student._id));
      // Current school year first; otherwise the latest enrollment.
      const enrollment =
        own.find((e) => currentYear && e.schoolYearId.equals(currentYear._id)) ?? own[0];
      if (!enrollment) continue;
      const [group, year, periods] = await Promise.all([
        this.groupModel.findById(enrollment.groupId).lean().exec(),
        this.yearModel.findById(enrollment.schoolYearId, { name: 1 }).lean().exec(),
        this.periodModel
          .find({ schoolYearId: enrollment.schoolYearId })
          .sort({ number: 1 })
          .lean()
          .exec(),
      ]);
      if (!group) continue;
      const teacher = group.homeroomTeacherId
        ? await this.userModel
            .findById(group.homeroomTeacherId, { firstName: 1, lastName: 1, email: 1 })
            .lean<Person>()
            .exec()
        : null;
      const statuses = await this.periodStatus.effectiveManyPeriods(
        periods.map((p) => p._id),
        group._id,
      );
      const current =
        periods.find((p) => p.startDate <= today && today <= p.endDate) ??
        [...periods].reverse().find((p) => p.startDate <= today) ??
        periods[0];
      views.push({
        id: student._id.toString(),
        firstName: student.firstName.split(/\s+/)[0] ?? student.firstName,
        shortName: shortStudentName(student),
        fullName: studentFullName(student),
        relationship: link.relationship,
        group: { id: group._id.toString(), name: group.name },
        teacher: teacher ? teacherSummary(teacher).name : null,
        schoolYear: year?.name ?? '',
        periods: periods.map((p): ChildPeriod => ({
          id: p._id.toString(),
          number: p.number,
          name: p.name,
          status: statuses.get(p._id.toString()) ?? p.status,
          current: Boolean(current?._id.equals(p._id)),
        })),
      });
    }
    return views;
  }

  /** Progress "en curso" per field with the visible grades only, and its weekly evolution. */
  async overview(studentId: string, periodId: string, actor: Actor): Promise<ChildOverview> {
    const { group, period } = await this.target(studentId, periodId, actor);
    const [scheme, activities, status] = await Promise.all([
      this.periodData.scheme(group.schoolYearId),
      this.visibleActivities(group._id, period._id),
      this.periodStatus.effective(period._id, group._id),
    ]);
    const grades = await this.gradeModel
      .find({ studentId: oid(studentId), activityId: { $in: activities.map((a) => a._id) } })
      .lean()
      .exec();
    const engineActivities = (until?: Date): EngineActivity[] =>
      activities
        .filter((a) => !until || a.date <= until)
        .map((a) => ({
          id: a._id.toString(),
          fieldKey: a.fieldKey,
          component: a.component,
          subjectKey: a.subjectKey ?? null,
        }));
    const engineGrades: EngineGrade[] = grades.map((g) => ({
      activityId: g.activityId.toString(),
      status: g.status,
      score: g.score ?? null,
    }));
    // Only graded activities count for the average "en curso": pending ones are left out.
    const graded = new Set(engineGrades.map((g) => g.activityId));
    const resultAt = (until?: Date) =>
      studentPeriodResult(
        scheme,
        engineActivities(until).filter((a) => graded.has(a.id)),
        engineGrades,
      );

    const result = resultAt();
    const fieldDefs = [...scheme.fields].sort((a, b) => a.order - b.order);
    const fields = fieldDefs.map((def) => {
      const value = result.fields.find((f) => f.fieldKey === def.key)?.calculated ?? null;
      const average = value === null ? null : roundTo(value, 1);
      return {
        fieldKey: def.key as FieldKey,
        name: def.name || FIELD_NAMES[def.key as FieldKey],
        shortName: FIELD_SHORT_NAMES[def.key as FieldKey],
        color: def.color,
        average,
        needsSupport: average !== null && average < scheme.lowThreshold,
      };
    });
    const support = fields.filter((f) => f.needsSupport).map((f) => f.shortName);

    const weekly: ChildOverview['weekly'] = [];
    const end = new Date(Math.min(Date.now(), period.endDate.getTime()));
    for (
      let monday = mondayOf(period.startDate);
      monday <= end && weekly.length < 30;
      monday = new Date(monday.getTime() + 7 * DAY_MS)
    ) {
      const sunday = new Date(monday.getTime() + 7 * DAY_MS - 1);
      const at = resultAt(sunday);
      const values: Partial<Record<FieldKey, number>> = {};
      for (const f of at.fields) {
        if (f.calculated !== null) values[f.fieldKey] = roundTo(f.calculated, 1);
      }
      if (Object.keys(values).length) weekly.push({ week: dateToDateOnly(monday), values });
    }

    return {
      period: { id: period._id.toString(), name: period.name, status },
      fields,
      supportMessage: support.length ? `Necesita apoyo en ${joinNames(support)}.` : null,
      weekly,
    };
  }

  async activities(studentId: string, periodId: string, actor: Actor): Promise<ChildActivity[]> {
    const { group, period } = await this.target(studentId, periodId, actor);
    const activities = await this.visibleActivities(group._id, period._id);
    const grades = await this.gradeModel
      .find({ studentId: oid(studentId), activityId: { $in: activities.map((a) => a._id) } })
      .lean()
      .exec();
    const gradeBy = new Map(grades.map((g) => [g.activityId.toString(), g]));
    return activities
      .map((a) => {
        const grade = gradeBy.get(a._id.toString());
        return {
          id: a._id.toString(),
          name: a.name,
          fieldKey: a.fieldKey,
          component: a.component,
          date: dateToDateOnly(a.date),
          grade: grade ? { status: grade.status, score: grade.score ?? null } : null,
        };
      })
      .sort((a, b) => b.date.localeCompare(a.date));
  }

  /** Notes marked visible for guardians; SALUD notes never leave the school. */
  async notes(studentId: string, periodId: string | undefined, actor: Actor): Promise<ChildNote[]> {
    if (periodId) await this.target(studentId, periodId, actor);
    else await this.link(studentId, actor);
    const notes = await this.noteModel
      .find({
        studentId: oid(studentId),
        schoolId: oid(actor.user.schoolId),
        deletedAt: null,
        visibleToGuardians: true,
        kind: { $ne: 'SALUD' },
        ...(periodId ? { periodId: oid(periodId) } : {}),
      })
      .sort({ date: -1, createdAt: -1 })
      .lean()
      .exec();
    const authors = await this.userModel
      .find({ _id: { $in: notes.map((n) => n.authorId) } }, { firstName: 1, lastName: 1, email: 1 })
      .lean<Person[]>()
      .exec();
    const authorBy = new Map(authors.map((a) => [a._id.toString(), teacherSummary(a).name]));
    return notes.map((n) => ({
      id: n._id.toString(),
      date: dateToDateOnly(n.date),
      kind: n.kind,
      ...(n.fieldKey ? { fieldKey: n.fieldKey } : {}),
      text: n.text,
      author: authorBy.get(n.authorId.toString()) ?? '',
    }));
  }

  /**
   * Finals per field and period for the family: the published report card (photo) when the
   * period is PUBLISHED; otherwise the average "en curso" of the visible grades only.
   */
  async history(
    studentId: string,
    schoolYearId: string | undefined,
    actor: Actor,
  ): Promise<StudentHistory> {
    await this.link(studentId, actor);
    if (schoolYearId && !/^[a-f\d]{24}$/i.test(schoolYearId)) throw this.notFound();
    const enrollment = await this.historyService.enrollmentOf(
      studentId,
      actor.user.schoolId,
      schoolYearId,
    );
    if (!enrollment) throw this.notFound();
    const [student, year, periods, scheme] = await Promise.all([
      this.studentModel.findById(studentId).lean().exec(),
      this.yearModel.findById(enrollment.schoolYearId, { name: 1 }).lean().exec(),
      this.periodModel
        .find({ schoolYearId: enrollment.schoolYearId })
        .sort({ number: 1 })
        .lean()
        .exec(),
      this.periodData.scheme(enrollment.schoolYearId),
    ]);
    if (!student) throw this.notFound();
    const statuses = await this.periodStatus.effectiveManyPeriods(
      periods.map((p) => p._id),
      enrollment.groupId,
    );
    const snapshots = await this.resultModel
      .find({
        studentId: oid(studentId),
        periodId: { $in: periods.map((p) => p._id) },
        snapshotAt: { $ne: null },
      })
      .lean()
      .exec();
    const now = new Date();
    const result: HistoryPeriod[] = [];
    for (const period of periods) {
      const status = statuses.get(period._id.toString()) ?? period.status;
      const base = { id: period._id.toString(), number: period.number, name: period.name, status };
      const snapshot = snapshots.find((s) => s.periodId.equals(period._id));
      if (status === 'PUBLISHED' && snapshot) {
        result.push({
          ...base,
          source: 'snapshot',
          values: Object.fromEntries(snapshot.fields.map((f) => [f.fieldKey, f.final ?? null])),
          generalAverage: snapshot.generalAverage ?? null,
        });
      } else if (period.startDate > now) {
        result.push({ ...base, source: 'none', values: {}, generalAverage: null });
      } else {
        const overview = await this.overview(studentId, period._id.toString(), actor);
        const values = Object.fromEntries(overview.fields.map((f) => [f.fieldKey, f.average]));
        result.push({
          ...base,
          source: overview.fields.some((f) => f.average !== null) ? 'live' : 'none',
          values,
          generalAverage: null,
        });
      }
    }
    return {
      student: { id: student._id.toString(), fullName: studentFullName(student) },
      schoolYear: { id: enrollment.schoolYearId.toString(), name: year?.name ?? '' },
      fields: historyFields(scheme),
      periods: result,
    };
  }

  /** Report cards of PUBLISHED periods only, from the closing snapshot. */
  async reportCards(studentId: string, actor: Actor): Promise<ChildReportCard[]> {
    const children = await this.children(actor);
    const child = children.find((c) => c.id === studentId);
    if (!child) throw this.notFound();
    const published = child.periods.filter((p) => p.status === 'PUBLISHED');
    if (published.length === 0) return [];
    const [results, statusDocs, periods] = await Promise.all([
      this.resultModel
        .find({
          studentId: oid(studentId),
          periodId: { $in: published.map((p) => oid(p.id)) },
          snapshotAt: { $ne: null },
        })
        .lean()
        .exec(),
      Promise.all(published.map((p) => this.periodStatus.find(p.id, child.group.id))),
      this.periodModel
        .find({ _id: { $in: published.map((p) => oid(p.id)) } })
        .lean()
        .exec(),
    ]);
    const scheme = periods[0] ? await this.periodData.scheme(periods[0].schoolYearId) : null;
    const nameOf = (key: FieldKey) =>
      scheme?.fields.find((f) => f.key === key)?.name || FIELD_NAMES[key];
    return published.flatMap((p, i): ChildReportCard[] => {
      const result = results.find((r) => r.periodId.toString() === p.id);
      if (!result) return [];
      return [
        {
          period: { id: p.id, name: p.name, number: p.number },
          publishedAt: statusDocs[i]?.publishedAt?.toISOString() ?? null,
          fields: result.fields.map((f) => ({
            fieldKey: f.fieldKey,
            name: nameOf(f.fieldKey),
            final: f.final ?? null,
            adjusted: f.override !== null && f.override !== undefined,
          })),
          generalAverage: result.generalAverage ?? null,
        },
      ];
    });
  }

  async reportCardPdf(studentId: string, periodId: string, actor: Actor): Promise<ReportFile> {
    const { group, period } = await this.target(studentId, periodId, actor);
    const status = await this.periodStatus.effective(period._id, group._id);
    // Not published yet: the same 404 as a missing report card.
    if (status !== 'PUBLISHED')
      throw Errors.notFound('La boleta de este periodo aún no se publica.');
    const data = await this.cards.build(group, period, studentId);
    return this.cards.renderPdf(data);
  }
}
