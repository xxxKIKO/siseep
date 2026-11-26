import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument, Types } from 'mongoose';

/** A student is permanent across school years; enrollments link them to a group. */
@Schema({ collection: 'students', timestamps: true })
export class Student {
  @Prop({ type: 'ObjectId', ref: 'School', required: true })
  schoolId!: Types.ObjectId;

  @Prop({ required: true, trim: true })
  firstName!: string;

  /** Paternal surname. */
  @Prop({ required: true, trim: true })
  lastName1!: string;

  /** Maternal surname (may be empty). */
  @Prop({ trim: true, default: '' })
  lastName2!: string;

  /** Lowercase, accent-free "lastName1 lastName2 firstName", for search and duplicates. */
  @Prop({ required: true, index: true })
  searchName!: string;

  @Prop({ type: String, trim: true, uppercase: true, default: null })
  curp?: string | null;

  @Prop({ type: Date, default: null })
  birthDate?: Date | null;

  @Prop({ type: String, trim: true, default: null })
  notes?: string | null;

  @Prop({ type: 'ObjectId', ref: 'User' })
  createdBy?: Types.ObjectId;

  @Prop({ type: Date, default: null })
  deletedAt?: Date | null;
}

export type StudentDocument = HydratedDocument<Student>;
export const StudentSchema = SchemaFactory.createForClass(Student);
StudentSchema.index({ firstName: 'text', lastName1: 'text', lastName2: 'text' });
StudentSchema.index({ schoolId: 1, searchName: 1 });

export function normalizeName(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

export function searchNameOf(s: { firstName: string; lastName1: string; lastName2?: string }) {
  return normalizeName([s.lastName1, s.lastName2 ?? '', s.firstName].join(' '));
}
