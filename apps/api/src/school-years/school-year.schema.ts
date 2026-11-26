import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument, Types } from 'mongoose';

@Schema({ collection: 'schoolYears', timestamps: true })
export class SchoolYear {
  @Prop({ type: 'ObjectId', ref: 'School', required: true })
  schoolId!: Types.ObjectId;

  /** "2026-2027" */
  @Prop({ required: true, trim: true })
  name!: string;

  @Prop({ required: true })
  startDate!: Date;

  @Prop({ required: true })
  endDate!: Date;

  @Prop({ default: false })
  isCurrent!: boolean;

  @Prop({ type: 'ObjectId', ref: 'User' })
  createdBy?: Types.ObjectId;
}

export type SchoolYearDocument = HydratedDocument<SchoolYear>;
export const SchoolYearSchema = SchemaFactory.createForClass(SchoolYear);
SchoolYearSchema.index({ schoolId: 1, name: 1 }, { unique: true });
