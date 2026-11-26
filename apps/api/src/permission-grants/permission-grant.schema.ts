import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { GRANT_SCOPE_TYPES, type GrantScopeType } from '@siseep/shared';
import type { HydratedDocument, Types } from 'mongoose';

@Schema({ _id: false })
export class GrantScope {
  @Prop({ type: String, enum: GRANT_SCOPE_TYPES, required: true })
  type!: GrantScopeType;

  @Prop({ type: 'ObjectId', ref: 'Group' })
  groupId?: Types.ObjectId;
}

/** Special permission given by an admin (section 2). CRUD arrives in stage 1. */
@Schema({ collection: 'permissionGrants', timestamps: true })
export class PermissionGrant {
  @Prop({ type: 'ObjectId', ref: 'School', required: true })
  schoolId!: Types.ObjectId;

  @Prop({ type: 'ObjectId', ref: 'User', required: true, index: true })
  userId!: Types.ObjectId;

  /** e.g. `grade:update`. */
  @Prop({ required: true })
  action!: string;

  @Prop({ type: SchemaFactory.createForClass(GrantScope), required: true })
  scope!: GrantScope;

  @Prop({ type: Date, default: null })
  expiresAt?: Date | null;

  @Prop({ type: 'ObjectId', ref: 'User', required: true })
  grantedBy!: Types.ObjectId;

  @Prop({ trim: true })
  reason?: string;

  @Prop({ type: Date, default: null })
  deletedAt?: Date | null;
}

export type PermissionGrantDocument = HydratedDocument<PermissionGrant>;
export const PermissionGrantSchema = SchemaFactory.createForClass(PermissionGrant);
