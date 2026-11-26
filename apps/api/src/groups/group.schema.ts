import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument, Types } from 'mongoose';

@Schema({ collection: 'groups', timestamps: true })
export class Group {
  @Prop({ type: 'ObjectId', ref: 'School', required: true })
  schoolId!: Types.ObjectId;

  @Prop({ type: 'ObjectId', ref: 'SchoolYear', required: true })
  schoolYearId!: Types.ObjectId;

  @Prop({ required: true, min: 1, max: 6 })
  grade!: number;

  @Prop({ required: true, uppercase: true, trim: true })
  letter!: string;

  /** "5°B" */
  @Prop({ required: true, trim: true })
  name!: string;

  @Prop({ type: 'ObjectId', ref: 'User', default: null })
  homeroomTeacherId?: Types.ObjectId | null;

  @Prop({ type: 'ObjectId', ref: 'User' })
  createdBy?: Types.ObjectId;

  @Prop({ type: Date, default: null })
  deletedAt?: Date | null;
}

export type GroupDocument = HydratedDocument<Group>;
export const GroupSchema = SchemaFactory.createForClass(Group);
GroupSchema.index({ schoolYearId: 1, name: 1 }, { unique: true });

export function groupName(grade: number, letter: string): string {
  return `${grade}°${letter.toUpperCase()}`;
}
