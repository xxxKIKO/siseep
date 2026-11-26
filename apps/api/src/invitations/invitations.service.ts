import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { type CreateStaffInvitationInput, InvitationType, ROLE_LABELS } from '@siseep/shared';
import type { Model, Types } from 'mongoose';
import { Errors } from '../common/app.exception';
import { randomToken, sha256 } from '../common/crypto';
import type { RequestUser } from '../common/request-user';
import { AppConfigService } from '../config/app-config.service';
import { MailService } from '../mail/mail.service';
import { UsersService } from '../users/users.service';
import { Invitation, type InvitationDocument } from './invitation.schema';

export interface StaffInvitationView {
  id: string;
  email: string;
  roles: string[];
  expiresAt: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class InvitationsService {
  constructor(
    @InjectModel(Invitation.name) private readonly invitationModel: Model<Invitation>,
    private readonly users: UsersService,
    private readonly mail: MailService,
    private readonly config: AppConfigService,
  ) {}

  /** Creates a staff invitation in the admin's school and emails the link. */
  async createStaff(
    input: CreateStaffInvitationInput,
    actor: RequestUser,
  ): Promise<StaffInvitationView> {
    if (await this.users.findByEmail(input.email)) {
      throw Errors.conflict('Ya existe una cuenta con ese correo.');
    }

    const code = randomToken();
    const invitation = await this.invitationModel.create({
      schoolId: actor.schoolId,
      type: InvitationType.STAFF,
      codeHash: sha256(code),
      email: input.email,
      roles: input.roles,
      expiresAt: new Date(Date.now() + this.config.get('INVITATION_TTL_DAYS') * DAY_MS),
      createdBy: actor.id,
    });

    const link = `${this.config.get('WEB_URL')}/invitacion?codigo=${encodeURIComponent(code)}`;
    const roles = input.roles.map((role) => ROLE_LABELS[role]).join(', ');
    await this.mail.send({
      to: input.email,
      subject: 'Te invitaron al sistema de evaluación escolar',
      text: [
        'Hola:',
        '',
        `Te invitaron al sistema de evaluación de la escuela con el rol de: ${roles}.`,
        'Para crear tu cuenta, abre este enlace:',
        link,
        '',
        `El enlace vence en ${this.config.get('INVITATION_TTL_DAYS')} días y solo se puede usar una vez.`,
      ].join('\n'),
    });

    return {
      id: invitation._id.toString(),
      email: input.email,
      roles: invitation.roles,
      expiresAt: invitation.expiresAt.toISOString(),
    };
  }

  /** Finds a usable staff invitation by its code without consuming it. */
  async findUsableStaff(code: string): Promise<InvitationDocument> {
    const invitation = await this.invitationModel
      .findOne({
        codeHash: sha256(code),
        type: InvitationType.STAFF,
        usedAt: null,
        expiresAt: { $gt: new Date() },
      })
      .exec();
    if (!invitation || !invitation.email) throw Errors.invalidInvitation();
    return invitation;
  }

  /** Marks the invitation as used. Atomic: a code can only be consumed once. */
  async consume(invitation: InvitationDocument, userId: Types.ObjectId): Promise<void> {
    const result = await this.invitationModel
      .updateOne(
        { _id: invitation._id, usedAt: null },
        { $set: { usedAt: new Date(), usedBy: userId } },
      )
      .exec();
    if (result.modifiedCount !== 1) throw Errors.invalidInvitation();
  }
}
