import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  type ActivityListQuery,
  type ActivityView,
  dateOnlyToDate,
  dateToDateOnly,
  type UpdateActivityInput,
} from '@siseep/shared';
import type { Model, Types } from 'mongoose';
import { Errors } from '../common/app.exception';
import type { Actor } from '../common/request-user';
import { assertCan, oid, scopedQuery } from '../common/scope';
import { GroupsService } from '../groups/groups.service';
import { Period } from '../periods/period.schema';
import { Activity, type ActivityDocument } from './activity.schema';
import { Grade } from './grade.schema';

/**
 * Stage 1: list activities (scoped: a subject teacher only sees their subject) and fix the
 * name/date of imported ones. Creating activities and capturing grades is stage 2.
 */
@Injectable()
export class ActivitiesService {
  constructor(
    @InjectModel(Activity.name) private readonly activityModel: Model<Activity>,
    @InjectModel(Grade.name) private readonly gradeModel: Model<Grade>,
    @InjectModel(Period.name) private readonly periodModel: Model<Period>,
    private readonly groups: GroupsService,
  ) {}

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
          },
        ],
      })
      .sort({ fieldKey: 1, component: 1, date: 1, name: 1 })
      .exec();
    const counts = await this.gradeModel
      .aggregate<{ _id: Types.ObjectId; n: number }>([
        { $match: { activityId: { $in: activities.map((a) => a._id) } } },
        { $group: { _id: '$activityId', n: { $sum: 1 } } },
      ])
      .exec();
    const countBy = new Map(counts.map((c) => [c._id.toString(), c.n]));
    return activities.map((a) => toView(a, countBy.get(a._id.toString()) ?? 0));
  }

  async update(id: string, input: UpdateActivityInput, actor: Actor): Promise<ActivityView> {
    const activity = await this.activityModel
      .findOne({ _id: id, schoolId: actor.user.schoolId, deletedAt: null })
      .exec();
    if (!activity) throw Errors.notFound('La actividad no existe.');
    assertCan(actor.ability, 'read', 'Activity', activity);
    assertCan(actor.ability, 'update', 'Activity', activity);
    const period = await this.periodModel.findById(activity.periodId, { status: 1 }).lean();
    if (period?.status !== 'OPEN') throw Errors.periodNotOpen();

    if (input.name) activity.name = input.name;
    if (input.date) {
      activity.date = dateOnlyToDate(input.date);
      activity.dateText = null;
    }
    await activity.save();
    const graded = await this.gradeModel.countDocuments({ activityId: activity._id });
    return toView(activity, graded);
  }
}

function toView(a: ActivityDocument, gradedCount: number): ActivityView {
  return {
    id: a._id.toString(),
    groupId: a.groupId.toString(),
    periodId: a.periodId.toString(),
    fieldKey: a.fieldKey,
    component: a.component,
    ...(a.subjectKey ? { subjectKey: a.subjectKey } : {}),
    name: a.name,
    date: dateToDateOnly(a.date),
    gradedCount,
  };
}
