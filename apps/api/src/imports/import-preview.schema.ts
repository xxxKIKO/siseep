import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { ImportIssue } from '@siseep/shared';
import { type HydratedDocument, Schema as MongooseSchema, type Types } from 'mongoose';
import type { ParsedWorkbook } from './excel-parser';

export interface ResolvedActivity extends Omit<ParsedWorkbook['activities'][number], 'date'> {
  date: string;
}

export interface ImportPayload {
  students: (ParsedWorkbook['students'][number] & {
    status: 'new' | 'existing' | 'enrolled';
    studentId?: string;
  })[];
  activities: ResolvedActivity[];
  adjustments: ParsedWorkbook['adjustments'];
  observations: ParsedWorkbook['observations'];
}

/**
 * Result of `POST /imports/excel/preview`, kept 1 hour so `commit` imports exactly what the
 * admin reviewed (and works with several API instances).
 */
@Schema({ collection: 'importPreviews', timestamps: true })
export class ImportPreviewRecord {
  @Prop({ type: 'ObjectId', ref: 'School', required: true })
  schoolId!: Types.ObjectId;

  @Prop({ type: 'ObjectId', ref: 'Group', required: true })
  groupId!: Types.ObjectId;

  @Prop({ type: 'ObjectId', ref: 'Period', required: true })
  periodId!: Types.ObjectId;

  @Prop({ required: true })
  fileName!: string;

  @Prop({ type: MongooseSchema.Types.Mixed, required: true })
  payload!: ImportPayload;

  @Prop({ type: [MongooseSchema.Types.Mixed], default: [] })
  issues!: ImportIssue[];

  @Prop({ required: true })
  blocked!: boolean;

  @Prop({ type: 'ObjectId', ref: 'User', required: true })
  createdBy!: Types.ObjectId;

  @Prop({ type: Date, default: null })
  committedAt?: Date | null;

  @Prop({ required: true })
  expiresAt!: Date;
}

export type ImportPreviewDocument = HydratedDocument<ImportPreviewRecord>;
export const ImportPreviewSchema = SchemaFactory.createForClass(ImportPreviewRecord);
ImportPreviewSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
