import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { type Role, UserStatus } from '@siseep/shared';
import { type Model, Types } from 'mongoose';
import { User, type UserDocument } from './user.schema';

export interface CreateUserInput {
  schoolId: Types.ObjectId | string;
  email: string;
  passwordHash: string;
  firstName: string;
  lastName: string;
  roles: Role[];
  createdBy?: Types.ObjectId | string;
}

/**
 * Data access for users. Auth lookups by email/id are global on purpose (the user is not yet
 * scoped); every listing added in later stages must filter by schoolId.
 */
@Injectable()
export class UsersService {
  constructor(@InjectModel(User.name) private readonly userModel: Model<User>) {}

  findById(id: string): Promise<UserDocument | null> {
    if (!Types.ObjectId.isValid(id)) return Promise.resolve(null);
    return this.userModel.findOne({ _id: id, deletedAt: null }).exec();
  }

  findByEmail(email: string): Promise<UserDocument | null> {
    return this.userModel.findOne({ email: email.toLowerCase(), deletedAt: null }).exec();
  }

  findByEmailWithPassword(email: string): Promise<UserDocument | null> {
    return this.userModel
      .findOne({ email: email.toLowerCase(), deletedAt: null })
      .select('+passwordHash')
      .exec();
  }

  async create(input: CreateUserInput): Promise<UserDocument> {
    return this.userModel.create({ ...input, status: UserStatus.ACTIVE });
  }

  /** Only to undo an account that was just created (failed guardian sign-up). */
  async hardDelete(userId: Types.ObjectId): Promise<void> {
    await this.userModel.deleteOne({ _id: userId }).exec();
  }

  async setPassword(userId: Types.ObjectId | string, passwordHash: string): Promise<void> {
    await this.userModel.updateOne({ _id: userId }, { $set: { passwordHash } }).exec();
  }

  async touchLastLogin(userId: Types.ObjectId | string): Promise<void> {
    await this.userModel.updateOne({ _id: userId }, { $set: { lastLoginAt: new Date() } }).exec();
  }

  /**
   * Creates the user, or updates profile and roles of an existing one with the same email.
   * The password is only set on creation, so re-running the seed never overwrites it.
   */
  async upsertSeedUser(input: CreateUserInput): Promise<{ user: UserDocument; created: boolean }> {
    const existing = await this.findByEmail(input.email);
    if (existing) {
      existing.set({
        schoolId: input.schoolId,
        firstName: input.firstName,
        lastName: input.lastName,
        roles: input.roles,
        status: UserStatus.ACTIVE,
      });
      await existing.save();
      return { user: existing, created: false };
    }
    return { user: await this.create(input), created: true };
  }
}
