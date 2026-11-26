import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { FIELD_KEYS, type FieldKey } from '@siseep/shared';
import { type HydratedDocument, Schema as MongooseSchema, type Types } from 'mongoose';

@Schema({ _id: false })
export class PeriodResultField {
  @Prop({ type: String, enum: FIELD_KEYS, required: true })
  fieldKey!: FieldKey;

  /** D, P, E and complementary averages (filled when the period is closed, stage 4). */
  @Prop({ type: MongooseSchema.Types.Mixed, default: null })
  components?: Record<string, number | null> | null;

  @Prop({ type: Number, default: null })
  calculated?: number | null;

  @Prop({ type: Number, default: null })
  rounded?: number | null;

  /** Teacher's adjustment (5-10). Printed with "*". */
  @Prop({ type: Number, default: null })
  override?: number | null;

  @Prop({ type: String, default: null })
  overrideReason?: string | null;

  @Prop({ type: Number, default: null })
  final?: number | null;
}
const PeriodResultFieldSchema = SchemaFactory.createForClass(PeriodResultField);

@Schema({ _id: false })
export class PeriodObservations {
  @Prop({ type: String, default: null })
  general?: string | null;

  @Prop({ type: MongooseSchema.Types.Mixed, default: {} })
  byField!: Partial<Record<FieldKey, string>>;
}
const PeriodObservationsSchema = SchemaFactory.createForClass(PeriodObservations);

/**
 * Per-student period closing. In stage 1 the import only stores adjustments, observations and
 * the custom legend; calculated values and the snapshot arrive with the engine (stages 3-4).
 */
@Schema({ collection: 'periodResults', timestamps: true })
export class PeriodResult {
  @Prop({ type: 'ObjectId', ref: 'School', required: true })
  schoolId!: Types.ObjectId;

  @Prop({ type: 'ObjectId', ref: 'Period', required: true })
  periodId!: Types.ObjectId;

  @Prop({ type: 'ObjectId', ref: 'Group', required: true })
  groupId!: Types.ObjectId;

  @Prop({ type: 'ObjectId', ref: 'Student', required: true })
  studentId!: Types.ObjectId;

  @Prop({ type: [PeriodResultFieldSchema], default: [] })
  fields!: PeriodResultField[];

  @Prop({ type: Number, default: null })
  generalAverage?: number | null;

  @Prop({ type: PeriodObservationsSchema, default: () => ({ general: null, byField: {} }) })
  observations!: PeriodObservations;

  @Prop({ type: String, default: null })
  legendOverride?: string | null;

  @Prop({ type: String, default: null })
  legendSuggested?: string | null;

  @Prop({ type: Date, default: null })
  snapshotAt?: Date | null;
}

export type PeriodResultDocument = HydratedDocument<PeriodResult>;
export const PeriodResultSchema = SchemaFactory.createForClass(PeriodResult);
PeriodResultSchema.index({ periodId: 1, studentId: 1 }, { unique: true });
