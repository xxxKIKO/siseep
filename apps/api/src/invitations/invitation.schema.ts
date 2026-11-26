import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { INVITATION_TYPES, type InvitationType, ROLES, type Role } from '@siseep/shared';
import type { HydratedDocument, Types } from 'mongoose';

/** Sign-up invitation. STAFF uses an emailed link; GUARDIAN (stage 5) uses an 8-char code. */
@Schema({ collection: 'invitations', timestamps: true })
export class Invitation {
  @Prop({ type: 'ObjectId', ref: 'School', required: true })
  schoolId!: Types.ObjectId;

  @Prop({ type: String, enum: INVITATION_TYPES, required: true })
  type!: InvitationType;

  @Prop({ required: true, unique: true })
  codeHash!: string;

  @Prop({ lowercase: true, trim: true })
  email?: string;

  @Prop({ type: 'ObjectId', ref: 'Student' })
  studentId?: Types.ObjectId;

  @Prop({ type: [String], enum: ROLES, default: [] })
  roles!: Role[];

  @Prop({ required: true })
  expiresAt!: Date;

  @Prop({ type: Date, default: null })
  usedAt!: Date | null;

  @Prop({ type: 'ObjectId', ref: 'User', default: null })
  usedBy!: Types.ObjectId | null;

  @Prop({ type: 'ObjectId', ref: 'User', required: true })
  createdBy!: Types.ObjectId;
}

export type InvitationDocument = HydratedDocument<Invitation>;
export const InvitationSchema = SchemaFactory.createForClass(Invitation);
// Expired invitations are deleted by MongoDB.
InvitationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
