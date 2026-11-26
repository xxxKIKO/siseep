import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { PERIOD_STATUSES, PeriodStatus } from '@siseep/shared';
import type { HydratedDocument, Types } from 'mongoose';

@Schema({ collection: 'periods', timestamps: true })
export class Period {
  @Prop({ type: 'ObjectId', ref: 'School', required: true })
  schoolId!: Types.ObjectId;

  @Prop({ type: 'ObjectId', ref: 'SchoolYear', required: true })
  schoolYearId!: Types.ObjectId;

  /** 1-3 */
  @Prop({ required: true, min: 1, max: 3 })
  number!: number;

  @Prop({ required: true, trim: true })
  name!: string;

  @Prop({ required: true })
  startDate!: Date;

  @Prop({ required: true })
  endDate!: Date;

  @Prop({ type: String, enum: PERIOD_STATUSES, default: PeriodStatus.OPEN })
  status!: PeriodStatus;

  @Prop({ type: Date, default: null })
  deliveryDate?: Date | null;

  /** Free text printed on report cards ("miércoles 18 de noviembre de 2026"). */
  @Prop({ type: String, default: null, trim: true })
  deliveryDateText?: string | null;

  @Prop({ type: 'ObjectId', ref: 'User' })
  createdBy?: Types.ObjectId;
}

export type PeriodDocument = HydratedDocument<Period>;
export const PeriodSchema = SchemaFactory.createForClass(Period);
PeriodSchema.index({ schoolYearId: 1, number: 1 }, { unique: true });
