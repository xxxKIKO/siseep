import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import {
  ASSIGNMENT_SCOPES,
  type AssignmentScope,
  SUBJECT_KEYS,
  type SubjectKey,
} from '@siseep/shared';
import type { HydratedDocument, Types } from 'mongoose';

/** What each teacher teaches: a whole group (HOMEROOM) or one subject of it (SUBJECT). */
@Schema({ collection: 'teachingAssignments', timestamps: true })
export class TeachingAssignment {
  @Prop({ type: 'ObjectId', ref: 'School', required: true })
  schoolId!: Types.ObjectId;

  @Prop({ type: 'ObjectId', ref: 'User', required: true })
  teacherId!: Types.ObjectId;

  @Prop({ type: 'ObjectId', ref: 'Group', required: true })
  groupId!: Types.ObjectId;

  @Prop({ type: String, enum: ASSIGNMENT_SCOPES, required: true })
  scope!: AssignmentScope;

  @Prop({ type: String, enum: [...SUBJECT_KEYS, null], default: null })
  subjectKey?: SubjectKey | null;

  @Prop({ type: 'ObjectId', ref: 'User' })
  createdBy?: Types.ObjectId;

  @Prop({ type: Date, default: null })
  deletedAt?: Date | null;
}

export type TeachingAssignmentDocument = HydratedDocument<TeachingAssignment>;
export const TeachingAssignmentSchema = SchemaFactory.createForClass(TeachingAssignment);
TeachingAssignmentSchema.index({ teacherId: 1, groupId: 1 });
TeachingAssignmentSchema.index(
  { teacherId: 1, groupId: 1, scope: 1, subjectKey: 1 },
  { unique: true, partialFilterExpression: { deletedAt: { $type: 'null' } } },
);
