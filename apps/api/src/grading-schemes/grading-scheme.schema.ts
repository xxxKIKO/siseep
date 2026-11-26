import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { GradingField } from '@siseep/shared';
import { type HydratedDocument, Schema as MongooseSchema, type Types } from 'mongoose';

/**
 * Grading rules per school year (section 5). The shape is validated with zod
 * (`gradingSchemeSchema` in shared) before saving, so the subdocuments are stored as-is.
 */
@Schema({ collection: 'gradingSchemes', timestamps: true })
export class GradingScheme {
  @Prop({ type: 'ObjectId', ref: 'School', required: true })
  schoolId!: Types.ObjectId;

  @Prop({ type: 'ObjectId', ref: 'SchoolYear', required: true, unique: true })
  schoolYearId!: Types.ObjectId;

  @Prop({ type: [MongooseSchema.Types.Mixed], required: true })
  fields!: GradingField[];

  @Prop({ type: MongooseSchema.Types.Mixed, required: true })
  rounding!: { preDecimals: number; mode: 'HALF_UP' };

  @Prop({ required: true })
  lowThreshold!: number;

  @Prop({ required: true })
  lowLegend!: string;

  @Prop({ required: true })
  minFinal!: number;

  @Prop({ required: true })
  maxFinal!: number;

  @Prop({ type: 'ObjectId', ref: 'User' })
  updatedBy?: Types.ObjectId;
}

export type GradingSchemeDocument = HydratedDocument<GradingScheme>;
export const GradingSchemeSchema = SchemaFactory.createForClass(GradingScheme);
