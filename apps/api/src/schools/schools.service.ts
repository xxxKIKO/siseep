import { Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { LOGO_MAX_BYTES, type SchoolView, type UpdateSchoolInput } from '@siseep/shared';
import { type Connection, mongo, type Model, Types } from 'mongoose';
import { Errors } from '../common/app.exception';
import type { Actor } from '../common/request-user';
import { assertCan } from '../common/scope';
import { School, type SchoolDocument } from './school.schema';

export interface UpsertSchoolInput {
  name: string;
  shortName?: string;
  cct?: string;
  city?: string;
  state?: string;
}

const LOGO_BUCKET = 'files';

/** Detects PNG/JPEG by their magic bytes (the browser-sent MIME type is not trusted). */
export function detectImageType(buffer: Buffer): 'image/png' | 'image/jpeg' | null {
  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'image/png';
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  return null;
}

@Injectable()
export class SchoolsService {
  constructor(
    @InjectModel(School.name) private readonly schoolModel: Model<School>,
    @InjectConnection() private readonly connection: Connection,
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

  private bucket(): mongo.GridFSBucket {
    return new mongo.GridFSBucket(this.connection.db!, { bucketName: LOGO_BUCKET });
  }

  /** Stores the logo in GridFS (max 1 MB, PNG or JPEG) and deletes the previous one. */
  async setLogo(
    file: { buffer: Buffer; size: number } | undefined,
    actor: Actor,
  ): Promise<SchoolView> {
    const school = await this.load(actor);
    assertCan(actor.ability, 'update', 'School', school);
    if (!file) throw Errors.invalidFile('Elige una imagen PNG o JPG.');
    if (file.size > LOGO_MAX_BYTES) throw Errors.invalidFile('El logo debe pesar máximo 1 MB.');
    const contentType = detectImageType(file.buffer);
    if (!contentType) throw Errors.invalidFile('El logo debe ser una imagen PNG o JPG.');

    const bucket = this.bucket();
    const fileId = new Types.ObjectId();
    await new Promise<void>((resolve, reject) => {
      const upload = bucket.openUploadStreamWithId(fileId, `logo-${school._id.toString()}`, {
        metadata: { schoolId: school._id, kind: 'school-logo', contentType },
      });
      upload.once('finish', () => resolve());
      upload.once('error', reject);
      upload.end(file.buffer);
    });

    const previous = school.logoFileId;
    school.logoFileId = fileId;
    await school.save();
    if (previous) await bucket.delete(previous).catch(() => undefined);
    return toView(school);
  }

  async getLogo(actor: Actor): Promise<{ buffer: Buffer; contentType: string }> {
    const school = await this.load(actor);
    if (!school.logoFileId) throw Errors.notFound('La escuela aún no tiene logo.');
    const bucket = this.bucket();
    const [info] = await bucket.find({ _id: school.logoFileId }).toArray();
    if (!info) throw Errors.notFound('La escuela aún no tiene logo.');
    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      bucket
        .openDownloadStream(school.logoFileId!)
        .on('data', (chunk: Buffer) => chunks.push(chunk))
        .once('end', () => resolve())
        .once('error', reject);
    });
    const contentType =
      (info.metadata as { contentType?: string } | undefined)?.contentType ?? 'image/png';
    return { buffer: Buffer.concat(chunks), contentType };
  }
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
  };
}
