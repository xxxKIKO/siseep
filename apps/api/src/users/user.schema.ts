import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import {
  ROLES,
  type Role,
  USER_STATUSES,
  type User as PublicUser,
  UserStatus,
} from '@siseep/shared';
import type { HydratedDocument, Types } from 'mongoose';

@Schema({ collection: 'users', timestamps: true })
export class User {
  @Prop({ type: 'ObjectId', ref: 'School', required: true, index: true })
  schoolId!: Types.ObjectId;

  /** Login: "MAE26-0001" (type + year + consecutive). Assigned by UsernameService. */
  @Prop({ type: String, uppercase: true, trim: true })
  username?: string;

  /** Optional (profile, password recovery). Unique when present. */
  @Prop({ type: String, lowercase: true, trim: true, default: null })
  email?: string | null;

  /** argon2id hash. Never selected by default. */
  @Prop({ type: String, select: false, default: null })
  passwordHash!: string | null;

  @Prop({ required: true, trim: true })
  firstName!: string;

  @Prop({ trim: true, default: '' })
  lastName!: string;

  /** 10 digits. For guardians it identifies the same person across siblings. */
  @Prop({ type: String, trim: true, default: null })
  phone?: string | null;

  @Prop({ type: String, trim: true, default: null })
  address?: string | null;

  /** Created with a temporary password: must choose their own before using the system. */
  @Prop({ default: false })
  mustChangePassword!: boolean;

  @Prop({ type: [String], enum: ROLES, required: true })
  roles!: Role[];

  @Prop({ type: String, enum: USER_STATUSES, default: UserStatus.ACTIVE })
  status!: UserStatus;

  /** Profile photo (GridFS). Students never have one. */
  @Prop({ type: 'ObjectId', default: null })
  avatarFileId?: Types.ObjectId | null;

  /** Teacher's logo, printed on the right of the report card header. */
  @Prop({ type: 'ObjectId', default: null })
  logoFileId?: Types.ObjectId | null;

  @Prop({ type: Date, default: null })
  lastLoginAt?: Date | null;

  /** Privacy notice accepted by a guardian when linking (version and date). */
  @Prop({ type: Number, default: null })
  privacyAcceptedVersion?: number | null;

  @Prop({ type: Date, default: null })
  privacyAcceptedAt?: Date | null;

  @Prop({ type: 'ObjectId', ref: 'User' })
  createdBy?: Types.ObjectId;

  @Prop({ type: Date, default: null })
  deletedAt?: Date | null;
}

export type UserDocument = HydratedDocument<User>;
export const UserSchema = SchemaFactory.createForClass(User);
UserSchema.index(
  { username: 1 },
  { unique: true, partialFilterExpression: { username: { $type: 'string' } } },
);
UserSchema.index(
  { email: 1 },
  { unique: true, partialFilterExpression: { email: { $type: 'string' } } },
);
UserSchema.index({ schoolId: 1, phone: 1 });

/** Maps a user document to the public shape returned by the API. */
export function toPublicUser(user: UserDocument): PublicUser {
  return {
    id: user._id.toString(),
    schoolId: user.schoolId.toString(),
    username: user.username ?? '',
    email: user.email ?? null,
    firstName: user.firstName,
    lastName: user.lastName,
    phone: user.phone ?? null,
    address: user.address ?? null,
    hasPhoto: Boolean(user.avatarFileId),
    mustChangePassword: Boolean(user.mustChangePassword),
    roles: user.roles,
    status: user.status,
    lastLoginAt: user.lastLoginAt ? user.lastLoginAt.toISOString() : null,
    hasLogo: Boolean(user.logoFileId),
    privacyAcceptedVersion: user.privacyAcceptedVersion ?? null,
  };
}
