import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { PERIOD_STATUSES, type PeriodStatus } from '@siseep/shared';
import type { HydratedDocument, Types } from 'mongoose';

/**
 * Status of a period for one group: OPEN → IN_REVIEW → CLOSED → PUBLISHED.
 * Without a document the group follows the period's own status.
 */
@Schema({ collection: 'periodGroupStatuses', timestamps: true })
export class PeriodGroupStatus {
  @Prop({ type: 'ObjectId', ref: 'School', required: true })
  schoolId!: Types.ObjectId;

  @Prop({ type: 'ObjectId', ref: 'Period', required: true })
  periodId!: Types.ObjectId;

  @Prop({ type: 'ObjectId', ref: 'Group', required: true })
  groupId!: Types.ObjectId;

  @Prop({ type: String, enum: PERIOD_STATUSES, required: true })
  status!: PeriodStatus;

  @Prop({ type: Date, default: null })
  reviewRequestedAt?: Date | null;

  @Prop({ type: 'ObjectId', ref: 'User', default: null })
  reviewRequestedBy?: Types.ObjectId | null;

  @Prop({ type: Date, default: null })
  closedAt?: Date | null;

  @Prop({ type: 'ObjectId', ref: 'User', default: null })
  closedBy?: Types.ObjectId | null;

  @Prop({ type: Date, default: null })
  publishedAt?: Date | null;

  @Prop({ type: 'ObjectId', ref: 'User', default: null })
  publishedBy?: Types.ObjectId | null;

  @Prop({ type: Date, default: null })
  reopenedAt?: Date | null;

  @Prop({ type: 'ObjectId', ref: 'User', default: null })
  reopenedBy?: Types.ObjectId | null;

  @Prop({ type: String, default: null })
  reopenReason?: string | null;
}

export type PeriodGroupStatusDocument = HydratedDocument<PeriodGroupStatus>;
export const PeriodGroupStatusSchema = SchemaFactory.createForClass(PeriodGroupStatus);
PeriodGroupStatusSchema.index({ periodId: 1, groupId: 1 }, { unique: true });
