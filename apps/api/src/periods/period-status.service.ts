import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { PeriodStatus } from '@siseep/shared';
import type { ClientSession, Model, Types } from 'mongoose';
import { Errors } from '../common/app.exception';
import { oid } from '../common/scope';
import { PeriodGroupStatus, type PeriodGroupStatusDocument } from './period-group-status.schema';
import { Period } from './period.schema';

type Id = Types.ObjectId | string;

/**
 * Single source of truth for "can this group's period still be edited?".
 * - Activities, grades and the Excel import need OPEN.
 * - Adjustments, observations and daily notes need OPEN or IN_REVIEW.
 * - CLOSED and PUBLISHED: nothing changes until the admin reopens.
 */
@Injectable()
export class PeriodStatusService {
  constructor(
    @InjectModel(PeriodGroupStatus.name)
    private readonly statusModel: Model<PeriodGroupStatus>,
    @InjectModel(Period.name) private readonly periodModel: Model<Period>,
  ) {}

  async find(
    periodId: Id,
    groupId: Id,
    session?: ClientSession,
  ): Promise<PeriodGroupStatusDocument | null> {
    return this.statusModel
      .findOne({ periodId: oid(periodId), groupId: oid(groupId) }, null, { session })
      .exec();
  }

  /** The group's own status, or the period's when the group has none yet. */
  async effective(periodId: Id, groupId: Id, session?: ClientSession): Promise<PeriodStatus> {
    const own = await this.find(periodId, groupId, session);
    if (own) return own.status;
    const period = await this.periodModel
      .findById(periodId, { status: 1 }, { session })
      .lean()
      .exec();
    return period?.status ?? 'OPEN';
  }

  /** Effective status of many groups in one period (dashboards, lists). */
  async effectiveMany(periodId: Id, groupIds: Id[]): Promise<Map<string, PeriodStatus>> {
    const [period, rows] = await Promise.all([
      this.periodModel.findById(periodId, { status: 1 }).lean().exec(),
      this.statusModel
        .find({ periodId: oid(periodId), groupId: { $in: groupIds.map(oid) } })
        .lean()
        .exec(),
    ]);
    const byGroup = new Map(rows.map((r) => [r.groupId.toString(), r.status]));
    return new Map(
      groupIds.map((id) => [id.toString(), byGroup.get(id.toString()) ?? period?.status ?? 'OPEN']),
    );
  }

  /** Activities, grades, import. */
  async assertOpen(periodId: Id, groupId: Id, session?: ClientSession): Promise<void> {
    if ((await this.effective(periodId, groupId, session)) !== 'OPEN') throw Errors.periodNotOpen();
  }

  /** Adjustments, observations, legend and daily notes. */
  async assertResultsEditable(periodId: Id, groupId: Id, session?: ClientSession): Promise<void> {
    const status = await this.effective(periodId, groupId, session);
    if (status !== 'OPEN' && status !== 'IN_REVIEW') throw Errors.periodLocked();
  }

  /** Creates or updates the group's status document. */
  async set(
    schoolId: Id,
    periodId: Id,
    groupId: Id,
    changes: Partial<PeriodGroupStatus> & { status: PeriodStatus },
    session?: ClientSession,
  ): Promise<PeriodGroupStatusDocument> {
    const doc = await this.statusModel
      .findOneAndUpdate(
        { periodId: oid(periodId), groupId: oid(groupId) },
        { $set: changes, $setOnInsert: { schoolId: oid(schoolId) } },
        { upsert: true, new: true, session },
      )
      .exec();
    return doc!;
  }
}
