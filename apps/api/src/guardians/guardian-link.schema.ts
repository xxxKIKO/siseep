import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { RELATIONSHIPS, type Relationship } from '@siseep/shared';
import type { HydratedDocument, Types } from 'mongoose';

export const GUARDIAN_LINK_STATUSES = ['ACTIVE', 'REVOKED'] as const;
export type GuardianLinkStatusValue = (typeof GUARDIAN_LINK_STATUSES)[number];

/** Guardian ↔ student (section 4). Revoking keeps the row for the audit trail. */
@Schema({ collection: 'guardianLinks', timestamps: true })
export class GuardianLink {
  @Prop({ type: 'ObjectId', ref: 'School', required: true })
  schoolId!: Types.ObjectId;

  @Prop({ type: 'ObjectId', ref: 'User', required: true })
  guardianUserId!: Types.ObjectId;

  @Prop({ type: 'ObjectId', ref: 'Student', required: true, index: true })
  studentId!: Types.ObjectId;

  @Prop({ type: String, enum: RELATIONSHIPS, required: true })
  relationship!: Relationship;

  @Prop({ type: String, enum: GUARDIAN_LINK_STATUSES, default: 'ACTIVE' })
  status!: GuardianLinkStatusValue;

  @Prop({ type: 'ObjectId', ref: 'Invitation', default: null })
  inviteId?: Types.ObjectId | null;

  @Prop({ type: Date, default: null })
  revokedAt?: Date | null;

  @Prop({ type: 'ObjectId', ref: 'User', default: null })
  revokedBy?: Types.ObjectId | null;
}

export type GuardianLinkDocument = HydratedDocument<GuardianLink>;
export const GuardianLinkSchema = SchemaFactory.createForClass(GuardianLink);
GuardianLinkSchema.index({ guardianUserId: 1, studentId: 1 }, { unique: true });
