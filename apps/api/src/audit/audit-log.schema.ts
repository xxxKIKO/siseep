import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { AUDIT_ENTITIES, type AuditEntity, SUBJECT_KEYS, type SubjectKey } from '@siseep/shared';
import { type HydratedDocument, Schema as MongooseSchema, type Types } from 'mongoose';

/** Who changed what, when, with the value before and after (section 7, "Bitácora"). */
@Schema({ collection: 'auditLogs', timestamps: false })
export class AuditLog {
  @Prop({ type: 'ObjectId', ref: 'School', required: true })
  schoolId!: Types.ObjectId;

  @Prop({ type: 'ObjectId', ref: 'User', required: true })
  actorId!: Types.ObjectId;

  @Prop({ type: String, enum: ['create', 'update', 'delete'], required: true })
  action!: 'create' | 'update' | 'delete';

  @Prop({ type: String, enum: AUDIT_ENTITIES, required: true })
  entity!: AuditEntity;

  @Prop({ type: 'ObjectId', required: true })
  entityId!: Types.ObjectId;

  /** Group of the record, so teachers can see the log of their groups only. */
  @Prop({ type: 'ObjectId', ref: 'Group', default: null })
  groupId?: Types.ObjectId | null;

  /** Subject of the record (English, PE), for subject teachers' scope. */
  @Prop({ type: String, enum: [...SUBJECT_KEYS, null], default: null })
  subjectKey?: SubjectKey | null;

  @Prop({ type: MongooseSchema.Types.Mixed, default: null })
  before!: unknown;

  @Prop({ type: MongooseSchema.Types.Mixed, default: null })
  after!: unknown;

  @Prop({ required: true, default: () => new Date() })
  at!: Date;

  @Prop({ type: String, default: null })
  ip?: string | null;
}

export type AuditLogDocument = HydratedDocument<AuditLog>;
export const AuditLogSchema = SchemaFactory.createForClass(AuditLog);
AuditLogSchema.index({ entity: 1, entityId: 1 });
AuditLogSchema.index({ at: -1 });
AuditLogSchema.index({ schoolId: 1, groupId: 1, at: -1 });
