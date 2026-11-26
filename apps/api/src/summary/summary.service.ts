import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  FIELD_SHORT_NAMES,
  type FieldKey,
  type FieldStats,
  type GradeBucket,
  type GroupOverview,
  type GroupSummary,
  type PendingActivity,
  roundTo,
  type StudentSummaryView,
  type SummaryAlert,
  type SummaryAlertType,
} from '@siseep/shared';
import type { Model, Types } from 'mongoose';
import { Activity } from '../activities/activity.schema';
import { Grade } from '../activities/grade.schema';
import { Errors } from '../common/app.exception';
import type { Actor } from '../common/request-user';
import { asSubject, oid } from '../common/scope';
import type { GroupDocument } from '../groups/group.schema';
import { GroupsService } from '../groups/groups.service';
import { PeriodStatusService } from '../periods/period-status.service';
import { Period, type PeriodDocument } from '../periods/period.schema';
import { Enrollment } from '../students/enrollment.schema';
import { PeriodDataService } from './period-data.service';
import { SummaryCache } from './summary-cache.service';

const LOW_RED = 6;
const average = (values: number[]) =>
  values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
const bucketOf = (final: number): GradeBucket =>
  final < 6 ? 'lt6' : (String(Math.min(10, Math.floor(final))) as GradeBucket);

/**
 * Live summary (section 5 + stage 3). Two queries for the data that changes (activities and
 * grades of the group in the period) and the shared engine for every number — no aggregation
 * pipelines that would duplicate the grading rules.
 */
@Injectable()
export class SummaryService {
  constructor(
    @InjectModel(Activity.name) private readonly activityModel: Model<Activity>,
    @InjectModel(Grade.name) private readonly gradeModel: Model<Grade>,
    @InjectModel(Period.name) private readonly periodModel: Model<Period>,
    @InjectModel(Enrollment.name) private readonly enrollmentModel: Model<Enrollment>,
    private readonly groups: GroupsService,
    private readonly cache: SummaryCache,
    private readonly periodData: PeriodDataService,
    private readonly periodStatus: PeriodStatusService,
  ) {}

  async forGroup(groupId: string, periodId: string, actor: Actor): Promise<GroupSummary> {
    const group = await this.groups.load(groupId, actor);
    this.assertFullAccess(group, actor);
    const period = await this.periodOf(group, periodId);
    const cached = this.cache.get(group._id.toString(), period._id.toString());
    if (cached) return cached;
    const summary = await this.compute(group, period);
    this.cache.set(group._id.toString(), period._id.toString(), summary);
    return summary;
  }

  async forStudent(studentId: string, periodId: string, actor: Actor): Promise<StudentSummaryView> {
    const period = await this.periodModel
      .findOne({ _id: periodId, schoolId: actor.user.schoolId })
      .exec();
    if (!period) throw Errors.notFound('El periodo no existe.');
    const enrollment = await this.enrollmentModel
      .findOne({
        studentId: oid(studentId),
        schoolYearId: period.schoolYearId,
        schoolId: actor.user.schoolId,
      })
      .lean()
      .exec();
    if (!enrollment) throw Errors.notFound('El alumno no está inscrito en ese ciclo.');
    const summary = await this.forGroup(enrollment.groupId.toString(), periodId, actor);
    const row = summary.students.find((s) => s.student.id === studentId);
    if (!row) throw Errors.notFound('El alumno no está activo en el grupo.');

    // Activity detail of this student (one more read, not cached).
    const [activities, grades] = await Promise.all([
      this.activityModel
        .find({ groupId: enrollment.groupId, periodId: period._id, deletedAt: null })
        .sort({ component: 1, date: 1, name: 1 })
        .lean()
        .exec(),
      this.gradeModel
        .find({ periodId: period._id, studentId: oid(studentId) })
        .lean()
        .exec(),
    ]);
    const gradeBy = new Map(grades.map((g) => [g.activityId.toString(), g]));
    return {
      ...row,
      group: summary.group,
      period: summary.period,
      generatedAt: summary.generatedAt,
      fields: summary.fields,
      alerts: summary.alerts.filter((a) => a.studentId === studentId),
      activities: summary.fields.map((field) => ({
        fieldKey: field.key,
        items: activities
          .filter((a) => a.fieldKey === field.key)
          .map((a) => {
            const grade = gradeBy.get(a._id.toString());
            return {
              id: a._id.toString(),
              name: a.name,
              component: a.component,
              ...(a.subjectKey ? { subjectKey: a.subjectKey } : {}),
              date: a.date.toISOString().slice(0, 10),
              grade: grade
                ? {
                    status: grade.status,
                    score: grade.score ?? null,
                    comment: grade.comment ?? null,
                    updatedAt: (grade as unknown as { updatedAt: Date }).updatedAt.toISOString(),
                  }
                : null,
            };
          }),
      })),
    };
  }

  /** Director's dashboard: every visible group with its current period. */
  async overview(actor: Actor): Promise<GroupOverview[]> {
    const views = await this.groups.list(actor);
    const rows: GroupOverview[] = [];
    for (const view of views) {
      const base = {
        group: {
          id: view.id,
          name: view.name,
          grade: view.grade,
          schoolYearName: view.schoolYearName,
          ...(view.homeroomTeacher ? { homeroomTeacher: view.homeroomTeacher.name } : {}),
        },
        studentCount: view.studentCount,
      };
      const canSeeAll = actor.ability.can(
        'read',
        asSubject('Grade', { schoolId: actor.user.schoolId, groupId: view.id }),
      );
      if (!view.currentPeriod || !canSeeAll) {
        rows.push({
          ...base,
          period: view.currentPeriod ?? null,
          capture: null,
          byField: [],
          generalAverage: null,
          studentsWithAlerts: 0,
          alertCounts: { LOW_6: 0, LOW_7: 0, PENDING: 0, PARTIAL: 0 },
        });
        continue;
      }
      const summary = await this.forGroup(view.id, view.currentPeriod.id, actor);
      const alertCounts: Record<SummaryAlertType, number> = {
        LOW_6: 0,
        LOW_7: 0,
        PENDING: 0,
        PARTIAL: 0,
      };
      for (const alert of summary.alerts) alertCounts[alert.type]++;
      rows.push({
        ...base,
        period: summary.period,
        capture: summary.capture,
        byField: summary.stats.byField.map((f) => ({ fieldKey: f.fieldKey, average: f.average })),
        generalAverage: summary.stats.generalAverage,
        studentsWithAlerts: summary.stats.studentsWithAlerts,
        alertCounts,
      });
    }
    return rows;
  }

  // ---- calculation --------------------------------------------------------------
  private async compute(group: GroupDocument, period: PeriodDocument): Promise<GroupSummary> {
    const [{ scheme, activities, grades, rows }, status] = await Promise.all([
      this.periodData.load(group, period._id),
      this.periodStatus.effective(period._id, group._id),
    ]);

    // Alerts per student and field.
    const alerts: SummaryAlert[] = [];
    for (const { student, result } of rows) {
      for (const field of result.fields) {
        if (field.calculated !== null && field.calculated < LOW_RED) {
          alerts.push({
            studentId: student.id,
            fieldKey: field.fieldKey,
            type: 'LOW_6',
            value: field.calculated,
          });
        } else if (field.calculated !== null && field.calculated < scheme.lowThreshold) {
          alerts.push({
            studentId: student.id,
            fieldKey: field.fieldKey,
            type: 'LOW_7',
            value: field.calculated,
          });
        }
        if (field.pending > 0) {
          alerts.push({
            studentId: student.id,
            fieldKey: field.fieldKey,
            type: 'PENDING',
            value: field.pending,
          });
        }
        if (field.partial) {
          alerts.push({
            studentId: student.id,
            fieldKey: field.fieldKey,
            type: 'PARTIAL',
            value: field.calculated,
          });
        }
      }
    }

    const fieldKeys = [...scheme.fields].sort((a, b) => a.order - b.order).map((f) => f.key);
    const byField: FieldStats[] = fieldKeys.map((fieldKey) => {
      const fieldResults = rows.map((r) => r.result.fields.find((f) => f.fieldKey === fieldKey)!);
      const calculated = fieldResults
        .map((f) => f.calculated)
        .filter((n): n is number => n !== null);
      const finals = fieldResults.map((f) => f.final).filter((n): n is number => n !== null);
      const distribution: Record<GradeBucket, number> = {
        lt6: 0,
        '6': 0,
        '7': 0,
        '8': 0,
        '9': 0,
        '10': 0,
      };
      for (const final of finals) distribution[bucketOf(final)]++;
      const avg = average(calculated);
      const finalAvg = average(finals);
      return {
        fieldKey,
        average: avg === null ? null : roundTo(avg, 2),
        finalAverage: finalAvg === null ? null : roundTo(finalAvg, 2),
        distribution,
        lowCount: calculated.filter((n) => n < scheme.lowThreshold).length,
      };
    });
    const generals = rows
      .map((r) => r.result.generalAverage)
      .filter((n): n is number => n !== null);
    const generalAvg = average(generals);

    // Activities with students still pending (tap → capture).
    const gradedBy = new Map<string, number>();
    const activeIds = new Set(rows.map((r) => r.student.id));
    for (const g of grades) {
      if (activeIds.has(g.studentId.toString())) {
        gradedBy.set(g.activityId.toString(), (gradedBy.get(g.activityId.toString()) ?? 0) + 1);
      }
    }
    const pendingActivities: PendingActivity[] = activities
      .map((a) => ({
        activityId: a._id.toString(),
        name: a.name,
        fieldKey: a.fieldKey,
        component: a.component,
        ...(a.subjectKey ? { subjectKey: a.subjectKey } : {}),
        date: a.date.toISOString().slice(0, 10),
        pending: rows.length - (gradedBy.get(a._id.toString()) ?? 0),
      }))
      .filter((a) => a.pending > 0)
      .sort((a, b) => a.date.localeCompare(b.date));

    const expected = activities.length * rows.length;
    const captured = [...gradedBy.values()].reduce((a, b) => a + b, 0);

    return {
      group: { id: group._id.toString(), name: group.name },
      period: { id: period._id.toString(), name: period.name, status },
      generatedAt: new Date().toISOString(),
      fields: [...scheme.fields]
        .sort((a, b) => a.order - b.order)
        .map((f) => ({
          key: f.key,
          name: f.name,
          shortName: FIELD_SHORT_NAMES[f.key as FieldKey],
          color: f.color,
          ...(f.complementary ? { complementaryName: f.complementary.name } : {}),
        })),
      students: rows,
      stats: {
        byField,
        generalAverage: generalAvg === null ? null : roundTo(generalAvg, 1),
        studentsWithAlerts: new Set(
          alerts.filter((a) => a.type === 'LOW_6' || a.type === 'LOW_7').map((a) => a.studentId),
        ).size,
      },
      alerts,
      pendingActivities,
      capture: {
        activities: activities.length,
        expected,
        captured,
        percent: expected ? roundTo((captured / expected) * 100, 1) : 0,
      },
    };
  }

  /**
   * The summary mixes every field, so it needs read access to ALL the grades of the group:
   * homeroom teacher, director, admin. A subject teacher (English, PE) gets 403.
   */
  private assertFullAccess(group: GroupDocument, actor: Actor): void {
    if (
      !actor.ability.can(
        'read',
        asSubject('Grade', { schoolId: group.schoolId, groupId: group._id }),
      )
    ) {
      throw Errors.forbidden();
    }
  }

  private async periodOf(group: GroupDocument, periodId: string): Promise<PeriodDocument> {
    const period = await this.periodModel
      .findOne({ _id: periodId, schoolId: group.schoolId })
      .exec();
    if (!period) throw Errors.notFound('El periodo no existe.');
    if (!(period.schoolYearId as Types.ObjectId).equals(group.schoolYearId)) {
      throw Errors.badRequest('El periodo no pertenece al ciclo escolar del grupo.');
    }
    return period;
  }
}
