import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import {
  type ActivityListQuery,
  type ActivityView,
  type CreateActivityInput,
  dateOnlyToDate,
  dateToDateOnly,
  DEFAULT_GRADING_SCHEME,
  ErrorCode,
  type UpdateActivityInput,
} from '@siseep/shared';
import type { Connection, Model, Types } from 'mongoose';
import { AuditService } from '../audit/audit.service';
import { AppException, Errors } from '../common/app.exception';
import type { Actor } from '../common/request-user';
import { assertCan, oid, scopedQuery } from '../common/scope';
import { AppConfigService } from '../config/app-config.service';
import { GradingScheme } from '../grading-schemes/grading-scheme.schema';
import type { GroupDocument } from '../groups/group.schema';
import { GroupsService } from '../groups/groups.service';
import { Period, type PeriodDocument } from '../periods/period.schema';
import { Enrollment } from '../students/enrollment.schema';
import { SummaryCache } from '../summary/summary-cache.service';
import { Activity, type ActivityDocument } from './activity.schema';
import { Grade } from './grade.schema';

const HOUR_MS = 60 * 60 * 1000;

/** Audit snapshot of an activity. */
const snapshot = (a: ActivityDocument) => ({
  fieldKey: a.fieldKey,
  component: a.component,
  subjectKey: a.subjectKey ?? null,
  name: a.name,
  date: dateToDateOnly(a.date),
  medium: a.medium ?? null,
  description: a.description ?? null,
  visibleToGuardians: a.visibleToGuardians,
});

@Injectable()
export class ActivitiesService {
  constructor(
    @InjectModel(Activity.name) private readonly activityModel: Model<Activity>,
    @InjectModel(Grade.name) private readonly gradeModel: Model<Grade>,
    @InjectModel(Period.name) private readonly periodModel: Model<Period>,
    @InjectModel(GradingScheme.name) private readonly schemeModel: Model<GradingScheme>,
    @InjectModel(Enrollment.name) private readonly enrollmentModel: Model<Enrollment>,
    @InjectConnection() private readonly connection: Connection,
    private readonly groups: GroupsService,
    private readonly audit: AuditService,
    private readonly config: AppConfigService,
    private readonly summaryCache: SummaryCache,
  ) {}

  // ---- reads -----------------------------------------------------------------
  /** Activities of a group in a period. A subject teacher only gets their subject. */
  async listForGroup(
    groupId: string,
    query: ActivityListQuery,
    actor: Actor,
  ): Promise<ActivityView[]> {
    const group = await this.groups.load(groupId, actor);
    const scope = scopedQuery(actor, 'Activity');
    if (!scope) throw Errors.forbidden();
    const activities = await this.activityModel
      .find({
        $and: [
          scope,
          {
            groupId: group._id,
            periodId: oid(query.periodId),
            deletedAt: null,
            ...(query.fieldKey ? { fieldKey: query.fieldKey } : {}),
            ...(query.component ? { component: query.component } : {}),
          },
        ],
      })
      .sort({ fieldKey: 1, component: 1, date: 1, name: 1 })
      .exec();
    return this.toViews(activities, group._id);
  }

  /** Loads an activity the actor can read (404 / 403 otherwise). */
  async load(id: string, actor: Actor): Promise<ActivityDocument> {
    const activity = await this.activityModel
      .findOne({ _id: id, schoolId: actor.user.schoolId, deletedAt: null })
      .exec();
    if (!activity) throw Errors.notFound('La actividad no existe.');
    assertCan(actor.ability, 'read', 'Activity', activity);
    return activity;
  }

  async get(id: string, actor: Actor): Promise<ActivityView> {
    const activity = await this.load(id, actor);
    const [view] = await this.toViews([activity], activity.groupId);
    return view!;
  }

  // ---- writes ------------------------------------------------------------------
  async create(input: CreateActivityInput, actor: Actor): Promise<ActivityView> {
    const group = await this.groups.load(input.groupId, actor);
    assertCan(actor.ability, 'create', 'Activity', {
      schoolId: group.schoolId,
      groupId: group._id,
      subjectKey: input.subjectKey ?? null,
      fieldKey: input.fieldKey,
    });
    const period = await this.openPeriodOf(input.periodId, group);
    await this.assertComplementaryAllowed(group, input.fieldKey, input.component, input.subjectKey);
    await this.assertNameFree(group._id, period._id, input.fieldKey, input.component, input.name);

    const now = new Date();
    let activity!: ActivityDocument;
    await this.connection.transaction(async (session) => {
      const [created] = await this.activityModel.create(
        [
          {
            schoolId: group.schoolId,
            groupId: group._id,
            periodId: period._id,
            fieldKey: input.fieldKey,
            component: input.component,
            subjectKey: input.subjectKey ?? null,
            name: input.name,
            date: dateOnlyToDate(input.date),
            medium: input.medium ?? null,
            description: input.description ?? null,
            visibleToGuardians: input.visibleToGuardians,
            visibleFrom: new Date(
              now.getTime() + this.config.get('ACTIVITY_GUARDIAN_DELAY_HOURS') * HOUR_MS,
            ),
            createdBy: actor.user.id,
          },
        ],
        { session },
      );
      activity = created!;
      await this.audit.record(
        actor,
        [
          {
            action: 'create',
            entity: 'activity',
            entityId: activity._id,
            groupId: group._id,
            subjectKey: activity.subjectKey,
            after: snapshot(activity),
          },
        ],
        session,
      );
    });
    this.summaryCache.invalidateGroup(group._id.toString());
    const [view] = await this.toViews([activity], group._id);
    return view!;
  }

  async update(id: string, input: UpdateActivityInput, actor: Actor): Promise<ActivityView> {
    const activity = await this.load(id, actor);
    assertCan(actor.ability, 'update', 'Activity', activity);
    await this.assertPeriodOpen(activity.periodId);
    if (input.name && input.name !== activity.name) {
      await this.assertNameFree(
        activity.groupId,
        activity.periodId,
        activity.fieldKey,
        activity.component,
        input.name,
        activity._id,
      );
    }
    const before = snapshot(activity);
    if (input.name) activity.name = input.name;
    if (input.date) {
      activity.date = dateOnlyToDate(input.date);
      activity.dateText = null;
    }
    if (input.medium !== undefined) activity.medium = input.medium || null;
    if (input.description !== undefined) activity.description = input.description || null;
    if (input.visibleToGuardians !== undefined)
      activity.visibleToGuardians = input.visibleToGuardians;

    await this.connection.transaction(async (session) => {
      await activity.save({ session });
      await this.audit.record(
        actor,
        [
          {
            action: 'update',
            entity: 'activity',
            entityId: activity._id,
            groupId: activity.groupId,
            subjectKey: activity.subjectKey,
            before,
            after: snapshot(activity),
          },
        ],
        session,
      );
    });
    this.summaryCache.invalidateGroup(activity.groupId.toString());
    const [view] = await this.toViews([activity], activity.groupId);
    return view!;
  }

  /**
   * Soft-deletes the activity. If it already has grades the caller must confirm with
   * `force=true` (the grades stop counting) — the audit log keeps how many there were.
   */
  async remove(id: string, force: boolean, actor: Actor): Promise<void> {
    const activity = await this.load(id, actor);
    assertCan(actor.ability, 'delete', 'Activity', activity);
    await this.assertPeriodOpen(activity.periodId);
    const graded = await this.gradeModel.countDocuments({ activityId: activity._id });
    if (graded > 0 && !force) {
      throw new AppException(
        HttpStatus.CONFLICT,
        ErrorCode.ACTIVITY_HAS_GRADES,
        `La actividad tiene ${graded} calificaciones. Confirma para borrarla junto con ellas.`,
        { gradedCount: graded },
      );
    }
    await this.connection.transaction(async (session) => {
      activity.deletedAt = new Date();
      await activity.save({ session });
      await this.audit.record(
        actor,
        [
          {
            action: 'delete',
            entity: 'activity',
            entityId: activity._id,
            groupId: activity.groupId,
            subjectKey: activity.subjectKey,
            before: { ...snapshot(activity), gradedCount: graded },
          },
        ],
        session,
      );
    });
    this.summaryCache.invalidateGroup(activity.groupId.toString());
  }

  // ---- helpers -----------------------------------------------------------------
  async assertPeriodOpen(periodId: Types.ObjectId): Promise<void> {
    const period = await this.periodModel.findById(periodId, { status: 1 }).lean().exec();
    if (period?.status !== 'OPEN') throw Errors.periodNotOpen();
  }

  private async openPeriodOf(periodId: string, group: GroupDocument): Promise<PeriodDocument> {
    const period = await this.periodModel
      .findOne({ _id: periodId, schoolId: group.schoolId })
      .exec();
    if (!period) throw Errors.notFound('El periodo no existe.');
    if (!period.schoolYearId.equals(group.schoolYearId)) {
      throw Errors.badRequest('El periodo no pertenece al ciclo escolar del grupo.');
    }
    if (period.status !== 'OPEN') throw Errors.periodNotOpen();
    return period;
  }

  /** COMPLEMENTARIA only in fields with a complementary subject, and only that subject. */
  private async assertComplementaryAllowed(
    group: GroupDocument,
    fieldKey: string,
    component: string,
    subjectKey: string | undefined,
  ): Promise<void> {
    if (component !== 'COMPLEMENTARIA') return;
    const scheme =
      (await this.schemeModel.findOne({ schoolYearId: group.schoolYearId }).lean().exec()) ??
      DEFAULT_GRADING_SCHEME;
    const field = scheme.fields.find((f) => f.key === fieldKey);
    if (!field?.complementary) {
      throw Errors.badRequest('Este campo formativo no lleva materia complementaria.');
    }
    if (field.complementary.subjectKey !== subjectKey) {
      throw Errors.badRequest(
        `La materia complementaria de este campo es ${field.complementary.name}.`,
      );
    }
  }

  /** Names are unique per group + period + field + component (keeps the Excel import idempotent). */
  private async assertNameFree(
    groupId: Types.ObjectId,
    periodId: Types.ObjectId,
    fieldKey: string,
    component: string,
    name: string,
    exceptId?: Types.ObjectId,
  ): Promise<void> {
    const exists = await this.activityModel.exists({
      groupId,
      periodId,
      fieldKey,
      component,
      name,
      deletedAt: null,
      ...(exceptId ? { _id: { $ne: exceptId } } : {}),
    });
    if (exists)
      throw Errors.conflict(`Ya hay una actividad llamada "${name}" en ese campo y componente.`);
  }

  private async toViews(
    activities: ActivityDocument[],
    groupId: Types.ObjectId,
  ): Promise<ActivityView[]> {
    const [counts, studentCount] = await Promise.all([
      this.gradeModel
        .aggregate<{ _id: Types.ObjectId; n: number }>([
          { $match: { activityId: { $in: activities.map((a) => a._id) } } },
          { $group: { _id: '$activityId', n: { $sum: 1 } } },
        ])
        .exec(),
      this.enrollmentModel.countDocuments({ groupId, status: 'ACTIVE' }).exec(),
    ]);
    const countBy = new Map(counts.map((c) => [c._id.toString(), c.n]));
    return activities.map((a) =>
      toActivityView(a, countBy.get(a._id.toString()) ?? 0, studentCount),
    );
  }
}

export function toActivityView(
  a: ActivityDocument,
  gradedCount: number,
  studentCount: number,
): ActivityView {
  return {
    id: a._id.toString(),
    groupId: a.groupId.toString(),
    periodId: a.periodId.toString(),
    fieldKey: a.fieldKey,
    component: a.component,
    ...(a.subjectKey ? { subjectKey: a.subjectKey } : {}),
    name: a.name,
    date: dateToDateOnly(a.date),
    ...(a.medium ? { medium: a.medium } : {}),
    ...(a.description ? { description: a.description } : {}),
    visibleToGuardians: a.visibleToGuardians,
    visibleFrom: a.visibleFrom.toISOString(),
    gradedCount,
    studentCount,
    updatedAt: (a as unknown as { updatedAt: Date }).updatedAt.toISOString(),
  };
}
