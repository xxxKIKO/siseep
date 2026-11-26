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

  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  email!: string;

  /** argon2id hash. Never selected by default. */
  @Prop({ type: String, select: false, default: null })
  passwordHash!: string | null;

  @Prop({ required: true, trim: true })
  firstName!: string;

  @Prop({ trim: true, default: '' })
  lastName!: string;

  @Prop({ trim: true })
  phone?: string;

  @Prop({ type: [String], enum: ROLES, required: true })
  roles!: Role[];

  @Prop({ type: String, enum: USER_STATUSES, default: UserStatus.ACTIVE })
  status!: UserStatus;

  @Prop({ type: 'ObjectId' })
  avatarFileId?: Types.ObjectId;

  /** Teacher's logo, printed on the right of the report card header. */
  @Prop({ type: 'ObjectId', default: null })
  logoFileId?: Types.ObjectId | null;

  @Prop({ type: Date, default: null })
  lastLoginAt?: Date | null;

  @Prop({ type: 'ObjectId', ref: 'User' })
  createdBy?: Types.ObjectId;

  @Prop({ type: Date, default: null })
  deletedAt?: Date | null;
}

export type UserDocument = HydratedDocument<User>;
export const UserSchema = SchemaFactory.createForClass(User);

/** Maps a user document to the public shape returned by the API. */
export function toPublicUser(user: UserDocument): PublicUser {
  return {
    id: user._id.toString(),
    schoolId: user.schoolId.toString(),
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    ...(user.phone ? { phone: user.phone } : {}),
    roles: user.roles,
    status: user.status,
    lastLoginAt: user.lastLoginAt ? user.lastLoginAt.toISOString() : null,
    hasLogo: Boolean(user.logoFileId),
  };
}
