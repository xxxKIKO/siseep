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

  /**
   * Validates the refresh token and replaces its secret. Throws on invalid or reused tokens.
   *
   * Reuse interval: for REFRESH_REUSE_GRACE_SECONDS after a rotation the immediately previous
   * secret is still accepted (and rotated again). Without it, a refresh whose response is lost
   * (tab closed, page reloaded, signal dropped mid-request) leaves the browser with the old
   * cookie, and the next refresh would look like theft and log the person out everywhere.
   * After the grace period, the old secret is treated as reuse.
   */
  async rotate(
    refreshToken: string | undefined,
    meta: ClientMeta,
    attempt = 0,
  ): Promise<IssuedSession> {
    const parsed = parseRefreshToken(refreshToken);
    if (!parsed) throw Errors.invalidRefreshToken();

    const session = await this.sessionModel.findById(parsed.sessionId).exec();
    if (!session || session.revokedAt || session.expiresAt.getTime() <= Date.now()) {
      throw Errors.invalidRefreshToken();
    }

    const presentedHash = sha256(parsed.secret);
    const graceMs = this.config.get('REFRESH_REUSE_GRACE_SECONDS') * 1000;
    const isCurrent = safeEqualHex(presentedHash, session.tokenHash);
    const isRecentPrevious =
      !isCurrent &&
      session.previousTokenHash !== null &&
      safeEqualHex(presentedHash, session.previousTokenHash) &&
      session.rotatedAt !== null &&
      Date.now() - session.rotatedAt.getTime() <= graceMs;
    if (!isCurrent && !isRecentPrevious) await this.handleReuse(session.userId);

    const secret = randomToken();
    const updated = await this.sessionModel
      .findOneAndUpdate(
        // Same version we validated: a concurrent rotation in between makes this miss.
        { _id: session._id, tokenHash: session.tokenHash, revokedAt: null },
        {
          $set: {
            tokenHash: sha256(secret),
            previousTokenHash: session.tokenHash,
            rotatedAt: new Date(),
            expiresAt: this.expiry(),
            lastUsedAt: new Date(),
            ip: meta.ip,
            userAgent: meta.userAgent,
          },
        },
        { new: true },
      )
      .exec();
    if (!updated) {
      // Another request rotated first. Within the grace period that is a race (two requests
      // with the same cookie): retry once against the new version; otherwise it is reuse.
      if ((isCurrent || isRecentPrevious) && attempt === 0) {
        const retry = await this.sessionModel.findById(session._id).exec();
        if (
          retry &&
          !retry.revokedAt &&
          retry.previousTokenHash !== null &&
          safeEqualHex(presentedHash, retry.previousTokenHash) &&
          retry.rotatedAt !== null &&
          Date.now() - retry.rotatedAt.getTime() <= graceMs
        ) {
          return this.rotate(refreshToken, meta, attempt + 1);
        }
      }
      await this.handleReuse(session.userId);
    }

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
