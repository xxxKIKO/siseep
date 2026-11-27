import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  type CreatedAccountView,
  type CreateStaffData,
  type Paginated,
  Role,
  TEMP_PASSWORD_ALPHABET,
  type TemporaryPasswordView,
  type UpdateUserInput,
  type User as PublicUser,
  type UserListQuery,
  UserStatus,
} from '@siseep/shared';
import type { Model } from 'mongoose';
import { PasswordService } from '../auth/password.service';
import { SessionsService } from '../auth/sessions.service';
import { Errors } from '../common/app.exception';
import { temporaryPassword } from '../common/crypto';
import type { Actor } from '../common/request-user';
import { requireScopedQuery } from '../common/scope';
import { normalizeName } from '../students/student.schema';
import { toPublicUser, User, type UserDocument } from './user.schema';
import { UsersService } from './users.service';

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Roles a director may give or manage (admins and directors stay with the admin). */
const DIRECTOR_MANAGES: Role[] = [Role.TEACHER, Role.GUARDIAN];
const isAdmin = (actor: Actor) => actor.user.roles.includes(Role.ADMIN);

/**
 * Accounts of the school: list, create (username + temporary password), roles, disable/enable
 * and temporary password. Admin: everything. Director: teachers and guardians only.
 */
@Injectable()
export class UsersAdminService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<User>,
    private readonly sessions: SessionsService,
    private readonly usersService: UsersService,
    private readonly passwords: PasswordService,
  ) {}

  /** A director may only touch accounts that are teachers or guardians (and nothing more). */
  private assertManageable(user: UserDocument, actor: Actor): void {
    if (isAdmin(actor)) return;
    if (!user.roles.every((role) => DIRECTOR_MANAGES.includes(role))) {
      throw Errors.forbidden();
    }
  }

  private assertGrantable(roles: readonly Role[], actor: Actor): void {
    if (isAdmin(actor)) return;
    if (!roles.every((role) => DIRECTOR_MANAGES.includes(role))) {
      throw Errors.badRequest('La dirección solo puede dar el rol de maestro(a).');
    }
  }

  async createStaff(input: CreateStaffData, actor: Actor): Promise<CreatedAccountView> {
    this.assertGrantable(input.roles, actor);
    if (input.email && (await this.usersService.findByEmail(input.email))) {
      throw Errors.conflict('Ese correo ya lo usa otra cuenta.');
    }
    const password = temporaryPassword(TEMP_PASSWORD_ALPHABET);
    const user = await this.usersService.create({
      schoolId: actor.user.schoolId,
      email: input.email,
      phone: input.phone,
      passwordHash: await this.passwords.hash(password),
      firstName: input.firstName,
      lastName: input.lastName,
      roles: input.roles,
      mustChangePassword: true,
      createdBy: actor.user.id,
    });
    return {
      user: toPublicUser(user),
      username: user.username!,
      temporaryPassword: password,
      existing: false,
    };
  }

  async list(query: UserListQuery, actor: Actor): Promise<Paginated<PublicUser>> {
    const conditions: Record<string, unknown>[] = [
      requireScopedQuery(actor, 'User'),
      { deletedAt: null },
    ];
    if (query.role) conditions.push({ roles: query.role });
    if (query.status) conditions.push({ status: query.status });
    if (query.q) {
      const pattern = new RegExp(escapeRegex(normalizeName(query.q)), 'i');
      conditions.push({
        $or: [
          { firstName: pattern },
          { lastName: pattern },
          { email: pattern },
          { username: pattern },
        ],
      });
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
    this.assertManageable(user, actor);
    if (input.roles) {
      this.assertGrantable(input.roles, actor);
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
    this.assertManageable(user, actor);
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
    this.assertManageable(user, actor);
    user.status = UserStatus.ACTIVE;
    await user.save();
    return toPublicUser(user);
  }

  /**
   * New temporary password (shown once to whoever resets it) and every session closed: the
   * person must choose their own password at the next sign-in. Works without email.
   */
  async resetToTemporary(id: string, actor: Actor): Promise<TemporaryPasswordView> {
    const user = await this.load(id, actor);
    this.assertManageable(user, actor);
    if (user.status !== UserStatus.ACTIVE) {
      throw Errors.badRequest('La cuenta está desactivada: actívala primero.');
    }
    const password = temporaryPassword(TEMP_PASSWORD_ALPHABET);
    await this.usersService.setPassword(user._id, await this.passwords.hash(password), true);
    await this.sessions.revokeAllForUser(user._id, 'RESET_BY_ADMIN');
    return { username: user.username ?? '', temporaryPassword: password };
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
