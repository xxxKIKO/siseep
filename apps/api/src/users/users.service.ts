import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import {
  formatUsername,
  normalizeLoginId,
  type Role,
  usernamePrefixFor,
  UserStatus,
} from '@siseep/shared';
import { type ClientSession, type Connection, type Model, Types } from 'mongoose';
import { User, type UserDocument } from './user.schema';

export interface CreateUserInput {
  schoolId: Types.ObjectId | string;
  email?: string | null;
  passwordHash: string;
  firstName: string;
  lastName: string;
  roles: Role[];
  phone?: string | null;
  address?: string | null;
  mustChangePassword?: boolean;
  createdBy?: Types.ObjectId | string;
}

/** Calendar year in Mexico City (the school's time zone). */
function currentYear(now = new Date()): number {
  return Number(
    new Intl.DateTimeFormat('en-US', { year: 'numeric', timeZone: 'America/Mexico_City' }).format(
      now,
    ),
  );
}

/**
 * Data access for users. Auth lookups by username/email/id are global on purpose (the user is
 * not yet scoped); every listing must filter by schoolId.
 */
@Injectable()
export class UsersService implements OnApplicationBootstrap {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @InjectModel(User.name) private readonly userModel: Model<User>,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  /** Accounts created before usernames existed get one at start-up. */
  async onApplicationBootstrap(): Promise<void> {
    const assigned = await this.ensureUsernames();
    if (assigned) this.logger.log(`Se asignó usuario a ${assigned} cuentas existentes.`);
  }

  // ---- usernames ---------------------------------------------------------------------
  /** Next consecutive for a prefix and year ("MAE" + 26 → MAE26-0001, MAE26-0002, …). Atomic. */
  async nextUsername(roles: readonly Role[], session?: ClientSession): Promise<string> {
    const year = currentYear();
    const prefix = usernamePrefixFor(roles);
    const key = `username:${prefix}${String(year % 100).padStart(2, '0')}`;
    const counter = await this.connection
      .collection<{ _id: string; seq: number }>('counters')
      .findOneAndUpdate(
        { _id: key },
        { $inc: { seq: 1 } },
        { upsert: true, returnDocument: 'after', session },
      );
    return formatUsername(prefix, year, counter!.seq);
  }

  /** Assigns a username to every account that has none (oldest first). Returns how many. */
  async ensureUsernames(): Promise<number> {
    const missing = await this.userModel
      .find({ $or: [{ username: { $exists: false } }, { username: null }, { username: '' }] })
      .sort({ createdAt: 1 })
      .exec();
    for (const user of missing) {
      user.username = await this.nextUsername(user.roles);
      await user.save();
    }
    return missing.length;
  }

  // ---- lookups ------------------------------------------------------------------------
  findById(id: string): Promise<UserDocument | null> {
    if (!Types.ObjectId.isValid(id)) return Promise.resolve(null);
    return this.userModel.findOne({ _id: id, deletedAt: null }).exec();
  }

  findByEmail(email: string): Promise<UserDocument | null> {
    return this.userModel.findOne({ email: email.toLowerCase(), deletedAt: null }).exec();
  }

  /** Login id: the username ("MAE26-0001") or, for older accounts, the email. */
  private loginFilter(loginId: string) {
    const id = normalizeLoginId(loginId);
    return id.includes('@') ? { email: id } : { username: id };
  }

  findByLoginId(loginId: string): Promise<UserDocument | null> {
    return this.userModel.findOne({ ...this.loginFilter(loginId), deletedAt: null }).exec();
  }

  findByLoginIdWithPassword(loginId: string): Promise<UserDocument | null> {
    return this.userModel
      .findOne({ ...this.loginFilter(loginId), deletedAt: null })
      .select('+passwordHash')
      .exec();
  }

  /** Kept for callers that still look accounts up by email (invitations). */
  findByEmailWithPassword(email: string): Promise<UserDocument | null> {
    return this.findByLoginIdWithPassword(email);
  }

  findWithPassword(id: Types.ObjectId | string): Promise<UserDocument | null> {
    return this.userModel.findOne({ _id: id, deletedAt: null }).select('+passwordHash').exec();
  }

  // ---- writes -------------------------------------------------------------------------
  async create(input: CreateUserInput, session?: ClientSession): Promise<UserDocument> {
    const username = await this.nextUsername(input.roles, session);
    const [user] = await this.userModel.create(
      [
        {
          ...input,
          email: input.email ? input.email.toLowerCase() : null,
          username,
          status: UserStatus.ACTIVE,
        },
      ],
      { session },
    );
    return user!;
  }

  /** Only to undo an account that was just created. */
  async hardDelete(userId: Types.ObjectId): Promise<void> {
    await this.userModel.deleteOne({ _id: userId }).exec();
  }

  async setPassword(
    userId: Types.ObjectId | string,
    passwordHash: string,
    mustChangePassword = false,
  ): Promise<void> {
    await this.userModel
      .updateOne({ _id: userId }, { $set: { passwordHash, mustChangePassword } })
      .exec();
  }

  async touchLastLogin(userId: Types.ObjectId | string): Promise<void> {
    await this.userModel.updateOne({ _id: userId }, { $set: { lastLoginAt: new Date() } }).exec();
  }

  /**
   * Creates the user, or updates profile and roles of an existing one with the same email.
   * The password is only set on creation, so re-running the seed never overwrites it.
   */
  async upsertSeedUser(
    input: CreateUserInput & { email: string },
  ): Promise<{ user: UserDocument; created: boolean }> {
    const existing = await this.findByEmail(input.email);
    if (existing) {
      existing.set({
        schoolId: input.schoolId,
        firstName: input.firstName,
        lastName: input.lastName,
        roles: input.roles,
        status: UserStatus.ACTIVE,
      });
      if (!existing.username) existing.username = await this.nextUsername(input.roles);
      await existing.save();
      return { user: existing, created: false };
    }
    return { user: await this.create(input), created: true };
  }
}
