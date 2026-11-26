import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  type Paginated,
  Role,
  type UpdateUserInput,
  type User as PublicUser,
  type UserListQuery,
  UserStatus,
} from '@siseep/shared';
import type { Model } from 'mongoose';
import { AuthService } from '../auth/auth.service';
import { SessionsService } from '../auth/sessions.service';
import { Errors } from '../common/app.exception';
import type { Actor } from '../common/request-user';
import { requireScopedQuery } from '../common/scope';
import { normalizeName } from '../students/student.schema';
import { toPublicUser, User, type UserDocument } from './user.schema';

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** User administration (admin only): list, roles, disable/enable and forced password reset. */
@Injectable()
export class UsersAdminService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<User>,
    private readonly auth: AuthService,
    private readonly sessions: SessionsService,
  ) {}

  async list(query: UserListQuery, actor: Actor): Promise<Paginated<PublicUser>> {
    const conditions: Record<string, unknown>[] = [
      requireScopedQuery(actor, 'User'),
      { deletedAt: null },
    ];
    if (query.role) conditions.push({ roles: query.role });
    if (query.status) conditions.push({ status: query.status });
    if (query.q) {
      const pattern = new RegExp(escapeRegex(normalizeName(query.q)), 'i');
      conditions.push({ $or: [{ firstName: pattern }, { lastName: pattern }, { email: pattern }] });
    }
    const filter = { $and: conditions };
    const [total, users] = await Promise.all([
      this.userModel.countDocuments(filter).exec(),
      this.userModel
        .find(filter)
        .sort({ firstName: 1, lastName: 1 })
        .skip((query.page - 1) * query.limit)
        .limit(query.limit)
        .exec(),
    ]);
    return { items: users.map(toPublicUser), total, page: query.page, limit: query.limit };
  }

  private async load(id: string, actor: Actor): Promise<UserDocument> {
    const user = await this.userModel
      .findOne({ _id: id, schoolId: actor.user.schoolId, deletedAt: null })
      .exec();
    if (!user) throw Errors.notFound('La persona no existe.');
    return user;
  }

  async update(id: string, input: UpdateUserInput, actor: Actor): Promise<PublicUser> {
    const user = await this.load(id, actor);
    if (input.roles) {
      const losesAdmin = user.roles.includes(Role.ADMIN) && !input.roles.includes(Role.ADMIN);
      if (losesAdmin && user._id.toString() === actor.user.id) {
        throw Errors.badRequest('No puedes quitarte tu propio rol de administración.');
      }
      if (losesAdmin) await this.assertAnotherAdmin(user);
      user.roles = input.roles;
    }
    if (input.firstName) user.firstName = input.firstName;
    if (input.lastName !== undefined) user.lastName = input.lastName;
    await user.save();
    return toPublicUser(user);
  }

  /** Disables the account and closes all its sessions. */
  async disable(id: string, actor: Actor): Promise<PublicUser> {
    const user = await this.load(id, actor);
    if (user._id.toString() === actor.user.id) {
      throw Errors.badRequest('No puedes desactivar tu propia cuenta.');
    }
    if (user.roles.includes(Role.ADMIN)) await this.assertAnotherAdmin(user);
    user.status = UserStatus.DISABLED;
    await user.save();
    await this.sessions.revokeAllForUser(user._id, 'DISABLED_BY_ADMIN');
    return toPublicUser(user);
  }

  async enable(id: string, actor: Actor): Promise<PublicUser> {
    const user = await this.load(id, actor);
    user.status = UserStatus.ACTIVE;
    await user.save();
    return toPublicUser(user);
  }

  /** Emails a reset link and closes the person's sessions, so they must choose a new password. */
  async forcePasswordReset(id: string, actor: Actor): Promise<void> {
    const user = await this.load(id, actor);
    if (user.status !== UserStatus.ACTIVE) {
      throw Errors.badRequest('La cuenta está desactivada: actívala primero.');
    }
    await this.sessions.revokeAllForUser(user._id, 'RESET_BY_ADMIN');
    await this.auth.sendPasswordReset(user, 'admin');
  }

  private async assertAnotherAdmin(user: UserDocument): Promise<void> {
    const others = await this.userModel.countDocuments({
      schoolId: user.schoolId,
      _id: { $ne: user._id },
      roles: Role.ADMIN,
      status: UserStatus.ACTIVE,
      deletedAt: null,
    });
    if (others === 0) {
      throw Errors.badRequest(
        'La escuela debe tener al menos otra persona con rol de administración.',
      );
    }
  }
}
