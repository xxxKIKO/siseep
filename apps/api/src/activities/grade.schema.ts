import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import {
  type Component,
  COMPONENTS,
  FIELD_KEYS,
  type FieldKey,
  GRADE_STATUSES,
  type GradeStatus,
  SUBJECT_KEYS,
  type SubjectKey,
} from '@siseep/shared';
import type { HydratedDocument, Types } from 'mongoose';

/**
 * A student's grade in one activity. groupId, periodId, fieldKey, component and subjectKey are
 * copied from the activity so scope filters (group, subject) work without joins.
 */
@Schema({ collection: 'grades', timestamps: true })
export class Grade {
  @Prop({ type: 'ObjectId', ref: 'School', required: true })
  schoolId!: Types.ObjectId;

  @Prop({ type: 'ObjectId', ref: 'Activity', required: true })
  activityId!: Types.ObjectId;

  @Prop({ type: 'ObjectId', ref: 'Student', required: true })
  studentId!: Types.ObjectId;

  @Prop({ type: 'ObjectId', ref: 'Group', required: true })
  groupId!: Types.ObjectId;

  @Prop({ type: 'ObjectId', ref: 'Period', required: true })
  periodId!: Types.ObjectId;

  @Prop({ type: String, enum: FIELD_KEYS, required: true })
  fieldKey!: FieldKey;

  @Prop({ type: String, enum: COMPONENTS, required: true })
  component!: Component;

  @Prop({ type: String, enum: [...SUBJECT_KEYS, null], default: null })
  subjectKey?: SubjectKey | null;

  /** SCORED, NOT_DELIVERED (counts as 0) or EXCUSED (does not count). */
  @Prop({ type: String, enum: GRADE_STATUSES, required: true })
  status!: GradeStatus;

  @Prop({ type: Number, default: null, min: 0, max: 10 })
  score?: number | null;

  @Prop({ type: String, trim: true, default: null })
  comment?: string | null;

  @Prop({ type: 'ObjectId', ref: 'User' })
  updatedBy?: Types.ObjectId;
}

export type GradeDocument = HydratedDocument<Grade>;
export const GradeSchema = SchemaFactory.createForClass(Grade);
GradeSchema.index({ activityId: 1, studentId: 1 }, { unique: true });
GradeSchema.index({ studentId: 1, periodId: 1 });
