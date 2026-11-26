import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { type Model, Types } from 'mongoose';
import { Errors } from '../common/app.exception';
import { randomToken, safeEqualHex, sha256 } from '../common/crypto';
import { AppConfigService } from '../config/app-config.service';
import type { UserDocument } from '../users/user.schema';
import { Session, type SessionDocument } from './session.schema';

export interface ClientMeta {
  ip: string;
  userAgent: string;
}

export interface IssuedSession {
  session: SessionDocument;
  /** Value for the refresh cookie: `<sessionId>.<secret>`. */
  refreshToken: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Refresh-token sessions. The token is `<sessionId>.<secret>`; only SHA-256(secret) is stored.
 * Each refresh replaces the secret. Presenting an old secret means the token was copied
 * (reuse), so every session of that user is revoked.
 */
@Injectable()
export class SessionsService {
  private readonly logger = new Logger(SessionsService.name);

  constructor(
    @InjectModel(Session.name) private readonly sessionModel: Model<Session>,
    private readonly config: AppConfigService,
  ) {}

  private expiry(): Date {
    return new Date(Date.now() + this.config.get('REFRESH_TOKEN_TTL_DAYS') * DAY_MS);
  }

  async create(user: UserDocument, meta: ClientMeta): Promise<IssuedSession> {
    const secret = randomToken();
    const session = await this.sessionModel.create({
      schoolId: user.schoolId,
      userId: user._id,
      tokenHash: sha256(secret),
      ip: meta.ip,
      userAgent: meta.userAgent,
      expiresAt: this.expiry(),
      lastUsedAt: new Date(),
    });
    return { session, refreshToken: `${session._id.toString()}.${secret}` };
  }

  /** Validates the refresh token and replaces its secret. Throws on invalid or reused tokens. */
  async rotate(refreshToken: string | undefined, meta: ClientMeta): Promise<IssuedSession> {
    const parsed = parseRefreshToken(refreshToken);
    if (!parsed) throw Errors.invalidRefreshToken();

    const session = await this.sessionModel.findById(parsed.sessionId).exec();
    if (!session || session.revokedAt || session.expiresAt.getTime() <= Date.now()) {
      throw Errors.invalidRefreshToken();
    }

    const presentedHash = sha256(parsed.secret);
    if (!safeEqualHex(presentedHash, session.tokenHash)) {
      await this.handleReuse(session.userId);
    }

    const secret = randomToken();
    const updated = await this.sessionModel
      .findOneAndUpdate(
        { _id: session._id, tokenHash: presentedHash, revokedAt: null },
        {
          $set: {
            tokenHash: sha256(secret),
            expiresAt: this.expiry(),
            lastUsedAt: new Date(),
            ip: meta.ip,
            userAgent: meta.userAgent,
          },
        },
        { new: true },
      )
      .exec();
    // Another request rotated the same secret first: the token was used twice.
    if (!updated) await this.handleReuse(session.userId);

    return { session: updated!, refreshToken: `${updated!._id.toString()}.${secret}` };
  }

  /** Revokes the session of this refresh token, if the token is valid. Never throws. */
  async revokeByToken(refreshToken: string | undefined): Promise<void> {
    const parsed = parseRefreshToken(refreshToken);
    if (!parsed) return;
    await this.sessionModel
      .updateOne(
        { _id: parsed.sessionId, tokenHash: sha256(parsed.secret), revokedAt: null },
        { $set: { revokedAt: new Date(), revokedReason: 'LOGOUT' } },
      )
      .exec();
  }

  async revokeAllForUser(userId: Types.ObjectId | string, reason: string): Promise<number> {
    const result = await this.sessionModel
      .updateMany(
        { userId: new Types.ObjectId(userId.toString()), revokedAt: null },
        { $set: { revokedAt: new Date(), revokedReason: reason } },
      )
      .exec();
    return result.modifiedCount;
  }

  /** True when the session exists, belongs to the user, and is neither revoked nor expired. */
  async isActive(sessionId: string, userId: string): Promise<boolean> {
    if (!Types.ObjectId.isValid(sessionId) || !Types.ObjectId.isValid(userId)) return false;
    const exists = await this.sessionModel
      .exists({
        _id: sessionId,
        userId,
        revokedAt: null,
        expiresAt: { $gt: new Date() },
      })
      .exec();
    return exists !== null;
  }

  private async handleReuse(userId: Types.ObjectId): Promise<never> {
    const revoked = await this.revokeAllForUser(userId, 'REUSE_DETECTED');
    this.logger.warn({ userId: userId.toString(), revoked }, 'Refresh token reuse detected');
    throw Errors.refreshTokenReused();
  }
}

function parseRefreshToken(
  token: string | undefined,
): { sessionId: string; secret: string } | null {
  if (!token || token.length > 200) return null;
  const [sessionId, secret, ...rest] = token.split('.');
  if (!sessionId || !secret || rest.length > 0 || !Types.ObjectId.isValid(sessionId)) return null;
  return { sessionId, secret };
}
