import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { FIELD_KEYS, type FieldKey, NOTE_KINDS, type NoteKind } from '@siseep/shared';
import type { HydratedDocument, Types } from 'mongoose';

/** Day-to-day observation about a student. SALUD notes are never visible to guardians. */
@Schema({ collection: 'studentNotes', timestamps: true })
export class StudentNote {
  @Prop({ type: 'ObjectId', ref: 'School', required: true })
  schoolId!: Types.ObjectId;

  @Prop({ type: 'ObjectId', ref: 'Student', required: true })
  studentId!: Types.ObjectId;

  @Prop({ type: 'ObjectId', ref: 'Group', required: true })
  groupId!: Types.ObjectId;

  @Prop({ type: 'ObjectId', ref: 'Period', required: true })
  periodId!: Types.ObjectId;

  @Prop({ type: 'ObjectId', ref: 'User', required: true })
  authorId!: Types.ObjectId;

  /** Calendar date (stored at 12:00 UTC). */
  @Prop({ required: true })
  date!: Date;

  @Prop({ type: String, enum: [...FIELD_KEYS, null], default: null })
  fieldKey?: FieldKey | null;

  @Prop({ type: String, enum: NOTE_KINDS, required: true })
  kind!: NoteKind;

  @Prop({ required: true, trim: true })
  text!: string;

  @Prop({ default: false })
  visibleToGuardians!: boolean;

  @Prop({ type: Date, default: null })
  deletedAt?: Date | null;
}

export type StudentNoteDocument = HydratedDocument<StudentNote>;
export const StudentNoteSchema = SchemaFactory.createForClass(StudentNote);
StudentNoteSchema.index({ studentId: 1, date: 1 });
StudentNoteSchema.index({ groupId: 1, date: 1 });
// Defense in depth: whatever path saves a note, SALUD is never visible to guardians.
StudentNoteSchema.pre('save', function () {
  if (this.kind === 'SALUD') this.visibleToGuardians = false;
});
