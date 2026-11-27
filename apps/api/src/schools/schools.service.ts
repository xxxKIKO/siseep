import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  defaultPrivacyNotice,
  type PrivacyNoticeView,
  type SchoolView,
  type UpdateSchoolInput,
} from '@siseep/shared';
import type { Model } from 'mongoose';
import { Errors } from '../common/app.exception';
import type { Actor } from '../common/request-user';
import { assertCan } from '../common/scope';
import { FilesService } from '../files/files.service';
import { School, type SchoolDocument } from './school.schema';

export interface UpsertSchoolInput {
  name: string;
  shortName?: string;
  cct?: string;
  city?: string;
  state?: string;
}

@Injectable()
export class SchoolsService {
  constructor(
    @InjectModel(School.name) private readonly schoolModel: Model<School>,
    private readonly files: FilesService,
  ) {}

  /** Creates the school or updates it when one with the same name exists (used by the seed). */
  async upsertByName(input: UpsertSchoolInput): Promise<SchoolDocument> {
    return this.schoolModel.findOneAndUpdate(
      { name: input.name },
      { $set: input },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
  }

  private async load(actor: Actor): Promise<SchoolDocument> {
    const school = await this.schoolModel
      .findOne({ _id: actor.user.schoolId, deletedAt: null })
      .exec();
    if (!school) throw Errors.notFound('No encontramos la escuela.');
    assertCan(actor.ability, 'read', 'School', school);
    return school;
  }

  async get(actor: Actor): Promise<SchoolView> {
    return toView(await this.load(actor));
  }

  async update(input: UpdateSchoolInput, actor: Actor): Promise<SchoolView> {
    const school = await this.load(actor);
    assertCan(actor.ability, 'update', 'School', school);
    school.set({ ...input, cct: input.cct === '' ? undefined : input.cct });
    await school.save();
    return toView(school);
  }

  /** Stores the logo in GridFS (max 1 MB, PNG or JPEG) and deletes the previous one. */
  async setLogo(
    file: { buffer: Buffer; size: number } | undefined,
    actor: Actor,
  ): Promise<SchoolView> {
    const school = await this.load(actor);
    assertCan(actor.ability, 'update', 'School', school);
    const fileId = await this.files.storeLogo(file, { schoolId: school._id, kind: 'school-logo' });
    const previous = school.logoFileId;
    school.logoFileId = fileId;
    await school.save();
    await this.files.remove(previous);
    return toView(school);
  }

  /** Public privacy notice (single school per deployment): the template until it is edited. */
  async privacyNotice(): Promise<PrivacyNoticeView> {
    const school = await this.schoolModel
      .findOne({ deletedAt: null })
      .sort({ createdAt: 1 })
      .lean()
      .exec();
    if (!school) throw Errors.notFound('Aviso no disponible.');
    return noticeView(school);
  }

  /** Admin edits the notice: the version goes up, so guardians accept it again when linking. */
  async updatePrivacyNotice(text: string, actor: Actor): Promise<PrivacyNoticeView> {
    const school = await this.load(actor);
    assertCan(actor.ability, 'update', 'School', school);
    school.privacyNoticeText = text;
    school.privacyNoticeVersion = (school.privacyNoticeVersion ?? 1) + 1;
    school.privacyNoticeUpdatedAt = new Date();
    await school.save();
    return noticeView(school);
  }

  async getLogo(actor: Actor): Promise<{ buffer: Buffer; contentType: string }> {
    const school = await this.load(actor);
    const logo = await this.files.read(school.logoFileId);
    if (!logo) throw Errors.notFound('La escuela aún no tiene logo.');
    return logo;
  }
}

function noticeView(school: School): PrivacyNoticeView {
  return {
    schoolName: school.name,
    text: school.privacyNoticeText ?? defaultPrivacyNotice(school.name),
    version: school.privacyNoticeVersion ?? 1,
    updatedAt: school.privacyNoticeUpdatedAt?.toISOString() ?? null,
    pendingReview: !school.privacyNoticeText,
  };
}

function toView(school: SchoolDocument): SchoolView {
  return {
    id: school._id.toString(),
    name: school.name,
    ...(school.shortName ? { shortName: school.shortName } : {}),
    ...(school.cct ? { cct: school.cct } : {}),
    ...(school.city ? { city: school.city } : {}),
    ...(school.state ? { state: school.state } : {}),
    hasLogo: Boolean(school.logoFileId),
    teacherCanClosePeriod: school.teacherCanClosePeriod ?? false,
  };
}
