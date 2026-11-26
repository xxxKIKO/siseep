import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument, Types } from 'mongoose';

/** One active refresh token per login (device). The token itself is never stored. */
@Schema({ collection: 'sessions', timestamps: true })
export class Session {
  @Prop({ type: 'ObjectId', ref: 'School', required: true })
  schoolId!: Types.ObjectId;

  @Prop({ type: 'ObjectId', ref: 'User', required: true, index: true })
  userId!: Types.ObjectId;

  /** SHA-256 of the current refresh secret. Changes on every rotation. */
  @Prop({ required: true })
  tokenHash!: string;

  @Prop({ default: '' })
  userAgent!: string;

  @Prop({ default: '' })
  ip!: string;

  @Prop({ required: true })
  expiresAt!: Date;

  @Prop({ type: Date, default: null })
  revokedAt!: Date | null;

  @Prop({ type: String, default: null })
  revokedReason!: string | null;

  @Prop({ type: Date, default: null })
  lastUsedAt!: Date | null;
}

export type SessionDocument = HydratedDocument<Session>;
export const SessionSchema = SchemaFactory.createForClass(Session);
// MongoDB deletes the session document once it expires.
SessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
