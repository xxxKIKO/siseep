import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { LOGO_MAX_BYTES } from '@siseep/shared';
import { type Connection, mongo, Types } from 'mongoose';
import { Errors } from '../common/app.exception';

const BUCKET = 'files';

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

export interface StoredImage {
  buffer: Buffer;
  contentType: 'image/png' | 'image/jpeg';
}

/** Small images (logos) in MongoDB GridFS, so no extra file service is needed (section 3). */
@Injectable()
export class FilesService {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  private bucket(): mongo.GridFSBucket {
    return new mongo.GridFSBucket(this.connection.db!, { bucketName: BUCKET });
  }

  /** Validates (PNG/JPEG, max 1 MB) and stores a logo. Returns its file id. */
  async storeLogo(
    file: { buffer: Buffer; size: number } | undefined,
    metadata: Record<string, unknown>,
  ): Promise<Types.ObjectId> {
    if (!file) throw Errors.invalidFile('Elige una imagen PNG o JPG.');
    if (file.size > LOGO_MAX_BYTES) throw Errors.invalidFile('El logo debe pesar máximo 1 MB.');
    const contentType = detectImageType(file.buffer);
    if (!contentType) throw Errors.invalidFile('El logo debe ser una imagen PNG o JPG.');
    const fileId = new Types.ObjectId();
    await new Promise<void>((resolve, reject) => {
      const upload = this.bucket().openUploadStreamWithId(fileId, `logo-${fileId.toString()}`, {
        metadata: { ...metadata, contentType },
      });
      upload.once('finish', () => resolve());
      upload.once('error', reject);
      upload.end(file.buffer);
    });
    return fileId;
  }

  async read(fileId: Types.ObjectId | null | undefined): Promise<StoredImage | null> {
    if (!fileId) return null;
    const bucket = this.bucket();
    const [info] = await bucket.find({ _id: fileId }).toArray();
    if (!info) return null;
    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      bucket
        .openDownloadStream(fileId)
        .on('data', (chunk: Buffer) => chunks.push(chunk))
        .once('end', () => resolve())
        .once('error', reject);
    });
    const buffer = Buffer.concat(chunks);
    return { buffer, contentType: detectImageType(buffer) ?? 'image/png' };
  }

  async remove(fileId: Types.ObjectId | null | undefined): Promise<void> {
    if (fileId)
      await this.bucket()
        .delete(fileId)
        .catch(() => undefined);
  }
}
