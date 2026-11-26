import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument, Types } from 'mongoose';

@Schema({ collection: 'schools', timestamps: true })
export class School {
  @Prop({ required: true, trim: true })
  name!: string;

  @Prop({ trim: true })
  shortName?: string;

  @Prop({ trim: true })
  cct?: string;

  @Prop({ trim: true })
  city?: string;

  @Prop({ trim: true })
  state?: string;

  @Prop({ type: 'ObjectId' })
  logoFileId?: Types.ObjectId;

  @Prop({ type: 'ObjectId', ref: 'User' })
  createdBy?: Types.ObjectId;

  @Prop({ type: Date, default: null })
  deletedAt?: Date | null;
}

export type SchoolDocument = HydratedDocument<School>;
export const SchoolSchema = SchemaFactory.createForClass(School);
