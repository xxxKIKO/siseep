import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import {
  type Component,
  COMPONENTS,
  FIELD_KEYS,
  type FieldKey,
  SUBJECT_KEYS,
  type SubjectKey,
} from '@siseep/shared';
import type { HydratedDocument, Types } from 'mongoose';

@Schema({ collection: 'activities', timestamps: true })
export class Activity {
  @Prop({ type: 'ObjectId', ref: 'School', required: true })
  schoolId!: Types.ObjectId;

  @Prop({ type: 'ObjectId', ref: 'Group', required: true })
  groupId!: Types.ObjectId;

  @Prop({ type: 'ObjectId', ref: 'Period', required: true })
  periodId!: Types.ObjectId;

  @Prop({ type: String, enum: FIELD_KEYS, required: true })
  fieldKey!: FieldKey;

  @Prop({ type: String, enum: COMPONENTS, required: true })
  component!: Component;

  /** Only for COMPLEMENTARIA (English, PE) activities. */
  @Prop({ type: String, enum: [...SUBJECT_KEYS, null], default: null })
  subjectKey?: SubjectKey | null;

  @Prop({ required: true, trim: true })
  name!: string;

  @Prop({ required: true })
  date!: Date;

  /** Date as written in the imported Excel ("26/oct"), kept for reference. */
  @Prop({ type: String, default: null })
  dateText?: string | null;

  @Prop({ type: String, trim: true, default: null })
  medium?: string | null;

  @Prop({ type: String, trim: true, default: null })
  description?: string | null;

  @Prop({ default: true })
  visibleToGuardians!: boolean;

  @Prop({ required: true })
  visibleFrom!: Date;

  @Prop({ type: 'ObjectId', ref: 'User' })
  createdBy?: Types.ObjectId;

  @Prop({ type: Date, default: null })
  deletedAt?: Date | null;
}

export type ActivityDocument = HydratedDocument<Activity>;
export const ActivitySchema = SchemaFactory.createForClass(Activity);
ActivitySchema.index({ groupId: 1, periodId: 1, fieldKey: 1, component: 1 });
