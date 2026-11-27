import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  type ChangePasswordInput,
  type UpdateProfileData,
  type User as PublicUser,
  Role,
} from '@siseep/shared';
import type { Model } from 'mongoose';
import { PasswordService } from '../auth/password.service';
import { Errors } from '../common/app.exception';
import type { RequestUser } from '../common/request-user';
import { FilesService } from '../files/files.service';
import { School } from '../schools/school.schema';
import { toPublicUser, User } from './user.schema';
import { UsersService } from './users.service';

/** The signed-in person's own account: profile data, photo and password (stage 6 changes). */
@Injectable()
export class ProfileService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<User>,
    @InjectModel(School.name) private readonly schoolModel: Model<School>,
    private readonly users: UsersService,
    private readonly passwords: PasswordService,
    private readonly files: FilesService,
  ) {}

  async update(input: UpdateProfileData, me: RequestUser): Promise<PublicUser> {
    const user = me.doc;
    if (input.email && input.email !== user.email) {
      const taken = await this.userModel.exists({
        email: input.email,
        _id: { $ne: user._id },
        deletedAt: null,
      });
      if (taken) throw Errors.conflict('Ese correo ya lo usa otra cuenta.');
    }
    // A guardian's phone identifies them across siblings: it must stay unique among guardians.
    if (input.phone && input.phone !== user.phone && user.roles.includes(Role.GUARDIAN)) {
      const taken = await this.userModel.exists({
        schoolId: user.schoolId,
        phone: input.phone,
        roles: Role.GUARDIAN,
        _id: { $ne: user._id },
        deletedAt: null,
      });
      if (taken) {
        throw Errors.conflict('Ese teléfono ya está registrado en otra cuenta de padre o tutor.');
      }
    }
    user.firstName = input.firstName;
    user.lastName = input.lastName;
    user.email = input.email;
    user.phone = input.phone;
    user.address = input.address;
    await user.save();
    return toPublicUser(user);
  }

  /**
   * Changes the password (also the first time, from the temporary one). Guardians accept the
   * current privacy notice here when they have not accepted it yet.
   */
  async changePassword(input: ChangePasswordInput, me: RequestUser): Promise<PublicUser> {
    const user = await this.users.findWithPassword(me.doc._id);
    if (!user) throw Errors.unauthorized();
    if (!(await this.passwords.verify(user.passwordHash, input.currentPassword))) {
      throw Errors.badRequest('La contraseña actual no es correcta.');
    }
    if (input.currentPassword === input.newPassword) {
      throw Errors.badRequest('La nueva contraseña debe ser distinta de la actual.');
    }
    if (user.roles.includes(Role.GUARDIAN)) {
      const school = await this.schoolModel
        .findById(user.schoolId, { privacyNoticeVersion: 1 })
        .lean()
        .exec();
      const version = school?.privacyNoticeVersion ?? 1;
      if ((user.privacyAcceptedVersion ?? 0) < version) {
        if (!input.acceptPrivacy) {
          throw Errors.badRequest('Para continuar acepta el aviso de privacidad.');
        }
        user.privacyAcceptedVersion = version;
        user.privacyAcceptedAt = new Date();
      }
    }
    user.passwordHash = await this.passwords.hash(input.newPassword);
    user.mustChangePassword = false;
    await user.save();
    return toPublicUser(user);
  }

  async setPhoto(
    file: { buffer: Buffer; size: number } | undefined,
    me: RequestUser,
  ): Promise<PublicUser> {
    const fileId = await this.files.storeLogo(
      file,
      { userId: me.doc._id, kind: 'profile-photo' },
      'La foto',
    );
    const previous = me.doc.avatarFileId;
    me.doc.avatarFileId = fileId;
    await me.doc.save();
    await this.files.remove(previous);
    return toPublicUser(me.doc);
  }

  async removePhoto(me: RequestUser): Promise<PublicUser> {
    const previous = me.doc.avatarFileId;
    me.doc.avatarFileId = null;
    await me.doc.save();
    await this.files.remove(previous);
    return toPublicUser(me.doc);
  }

  photo(me: RequestUser) {
    return this.files.read(me.doc.avatarFileId);
  }
}
