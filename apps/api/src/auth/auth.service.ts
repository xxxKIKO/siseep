import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import {
  type AcceptInviteInput,
  type AccessTokenPayload,
  type AuthResponse,
  type GuardianCodePreview,
  type LoginInput,
  type RegisterGuardianInput,
  Role,
  type ResetPasswordInput,
  type User as PublicUser,
  UserStatus,
} from '@siseep/shared';
import type { Model } from 'mongoose';
import { Errors } from '../common/app.exception';
import { randomToken, sha256 } from '../common/crypto';
import type { RequestUser } from '../common/request-user';
import { AppConfigService } from '../config/app-config.service';
import { GuardianInvitationsService } from '../guardians/guardian-invitations.service';
import { InvitationsService } from '../invitations/invitations.service';
import { MailService } from '../mail/mail.service';
import { toPublicUser, type UserDocument } from '../users/user.schema';
import { UsersService } from '../users/users.service';
import { PasswordReset } from './password-reset.schema';
import { PasswordService } from './password.service';
import { type ClientMeta, type IssuedSession, SessionsService } from './sessions.service';

export interface AuthResult {
  body: AuthResponse;
  refreshToken: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly users: UsersService,
    private readonly sessions: SessionsService,
    private readonly passwords: PasswordService,
    private readonly invitations: InvitationsService,
    private readonly guardianInvitations: GuardianInvitationsService,
    private readonly jwt: JwtService,
    private readonly mail: MailService,
    private readonly config: AppConfigService,
    @InjectModel(PasswordReset.name) private readonly resetModel: Model<PasswordReset>,
  ) {}

  async login(input: LoginInput, meta: ClientMeta): Promise<AuthResult> {
    const user = await this.users.findByEmailWithPassword(input.email);
    if (!user) {
      await this.passwords.verifyDummy(input.password);
      throw Errors.invalidCredentials();
    }
    const valid = await this.passwords.verify(user.passwordHash, input.password);
    if (!valid) throw Errors.invalidCredentials();
    if (user.status !== UserStatus.ACTIVE) throw Errors.accountDisabled();

    await this.users.touchLastLogin(user._id);
    user.lastLoginAt = new Date();
    return this.issue(user, await this.sessions.create(user, meta));
  }

  async refresh(refreshToken: string | undefined, meta: ClientMeta): Promise<AuthResult> {
    const issued = await this.sessions.rotate(refreshToken, meta);
    const user = await this.users.findById(issued.session.userId.toString());
    if (!user || user.status !== UserStatus.ACTIVE) {
      await this.sessions.revokeAllForUser(issued.session.userId, 'USER_INACTIVE');
      throw Errors.invalidRefreshToken();
    }
    return this.issue(user, issued);
  }

  logout(refreshToken: string | undefined): Promise<void> {
    return this.sessions.revokeByToken(refreshToken);
  }

  async logoutAll(user: RequestUser): Promise<void> {
    await this.sessions.revokeAllForUser(user.id, 'LOGOUT_ALL');
  }

  me(user: RequestUser): PublicUser {
    return toPublicUser(user.doc);
  }

  /** Creates the staff account from an invitation and signs the person in. */
  async acceptInvite(input: AcceptInviteInput, meta: ClientMeta): Promise<AuthResult> {
    const invitation = await this.invitations.findUsableStaff(input.code);
    if (await this.users.findByEmail(invitation.email!)) {
      throw Errors.conflict('Ya existe una cuenta con ese correo. Inicia sesión.');
    }

    const user = await this.users.create({
      schoolId: invitation.schoolId,
      email: invitation.email!,
      passwordHash: await this.passwords.hash(input.password),
      firstName: input.firstName,
      lastName: input.lastName,
      roles: invitation.roles,
      createdBy: invitation.createdBy,
    });
    await this.invitations.consume(invitation, user._id);
    return this.issue(user, await this.sessions.create(user, meta));
  }

  previewGuardianCode(code: string): Promise<GuardianCodePreview> {
    return this.guardianInvitations.preview(code);
  }

  /**
   * Guardian sign-up with a code: creates the account (GUARDIAN, privacy notice accepted) and
   * the link in one go. If the code turns out to be unusable, the new account is removed.
   */
  async registerGuardian(input: RegisterGuardianInput, meta: ClientMeta): Promise<AuthResult> {
    const schoolId = await this.guardianInvitations.schoolOf(input.code);
    if (await this.users.findByEmail(input.email)) {
      throw Errors.conflict(
        'Ya existe una cuenta con ese correo. Inicia sesión para vincular a tu hijo(a).',
      );
    }
    const user = await this.users.create({
      schoolId,
      email: input.email,
      passwordHash: await this.passwords.hash(input.password),
      firstName: input.firstName,
      lastName: input.lastName,
      roles: [Role.GUARDIAN],
    });
    try {
      await this.guardianInvitations.redeem(user, input.code, input.relationship, {
        acceptPrivacy: true,
        ip: meta.ip,
      });
    } catch (error) {
      await this.users.hardDelete(user._id);
      throw error;
    }
    const fresh = (await this.users.findById(user._id.toString()))!;
    return this.issue(fresh, await this.sessions.create(fresh, meta));
  }

  /** Emails a reset link when the account exists. Always succeeds to not reveal accounts. */
  async forgotPassword(email: string): Promise<void> {
    const user = await this.users.findByEmail(email);
    if (!user || user.status !== UserStatus.ACTIVE) return;
    try {
      await this.sendPasswordReset(user, 'self');
    } catch (_error) {
      // Same response either way; the failure is logged by the mail service.
      this.logger.warn('Password reset email could not be sent');
    }
  }

  /**
   * Creates a one-time reset link (only the latest one works) and emails it.
   * `admin`: an administrator forced the reset; the email says so.
   */
  async sendPasswordReset(user: UserDocument, origin: 'self' | 'admin'): Promise<void> {
    const token = randomToken();
    const ttlMinutes = this.config.get('PASSWORD_RESET_TTL_MINUTES');
    await this.resetModel.updateMany(
      { userId: user._id, usedAt: null },
      { $set: { usedAt: new Date() } },
    );
    await this.resetModel.create({
      schoolId: user.schoolId,
      userId: user._id,
      tokenHash: sha256(token),
      expiresAt: new Date(Date.now() + ttlMinutes * 60_000),
    });

    const link = `${this.config.get('WEB_URL')}/restablecer?token=${encodeURIComponent(token)}`;
    const intro =
      origin === 'admin'
        ? 'La administración de la escuela pidió que elijas una nueva contraseña. Abre este enlace:'
        : 'Recibimos una solicitud para restablecer tu contraseña. Abre este enlace para elegir una nueva:';
    await this.mail.send({
      to: user.email,
      subject: 'Restablece tu contraseña',
      text: [
        `Hola, ${user.firstName}:`,
        '',
        intro,
        link,
        '',
        `El enlace vence en ${ttlMinutes} minutos.` +
          (origin === 'self' ? ' Si no lo pediste, ignora este correo.' : ''),
      ].join('\n'),
    });
  }

  async resetPassword(input: ResetPasswordInput): Promise<void> {
    const reset = await this.resetModel
      .findOneAndUpdate(
        { tokenHash: sha256(input.token), usedAt: null, expiresAt: { $gt: new Date() } },
        { $set: { usedAt: new Date() } },
        { new: true },
      )
      .exec();
    if (!reset) throw Errors.invalidResetToken();

    await this.users.setPassword(reset.userId, await this.passwords.hash(input.password));
    await this.sessions.revokeAllForUser(reset.userId, 'PASSWORD_RESET');
  }

  private async issue(user: UserDocument, issued: IssuedSession): Promise<AuthResult> {
    const payload: AccessTokenPayload = {
      sub: user._id.toString(),
      sid: issued.session._id.toString(),
      schoolId: user.schoolId.toString(),
      roles: user.roles,
    };
    const expiresIn = this.config.get('JWT_ACCESS_TTL');
    const accessToken = await this.jwt.signAsync(payload, { expiresIn });
    return {
      body: { accessToken, expiresIn, user: toPublicUser(user) },
      refreshToken: issued.refreshToken,
    };
  }
}
