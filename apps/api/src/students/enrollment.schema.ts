import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { ENROLLMENT_STATUSES, EnrollmentStatus } from '@siseep/shared';
import type { HydratedDocument, Types } from 'mongoose';

/** Student in a group for one school year, with their list number (N/L). */
@Schema({ collection: 'enrollments', timestamps: true })
export class Enrollment {
  @Prop({ type: 'ObjectId', ref: 'School', required: true })
  schoolId!: Types.ObjectId;

  @Prop({ type: 'ObjectId', ref: 'Student', required: true })
  studentId!: Types.ObjectId;

  @Prop({ type: 'ObjectId', ref: 'Group', required: true })
  groupId!: Types.ObjectId;

  /** Denormalized from the group: one enrollment per student and school year. */
  @Prop({ type: 'ObjectId', ref: 'SchoolYear', required: true })
  schoolYearId!: Types.ObjectId;

  @Prop({ required: true, min: 1, max: 99 })
  listNumber!: number;

  @Prop({ type: String, enum: ENROLLMENT_STATUSES, default: EnrollmentStatus.ACTIVE })
  status!: EnrollmentStatus;

  @Prop({ required: true })
  from!: Date;

  @Prop({ type: Date, default: null })
  to?: Date | null;

  @Prop({ type: 'ObjectId', ref: 'User' })
  createdBy?: Types.ObjectId;
}

export type EnrollmentDocument = HydratedDocument<Enrollment>;
export const EnrollmentSchema = SchemaFactory.createForClass(Enrollment);
// N/L is unique among the active students of a group.
EnrollmentSchema.index(
  { groupId: 1, listNumber: 1 },
  { unique: true, partialFilterExpression: { status: 'ACTIVE' } },
);
EnrollmentSchema.index({ studentId: 1, schoolYearId: 1 }, { unique: true });
