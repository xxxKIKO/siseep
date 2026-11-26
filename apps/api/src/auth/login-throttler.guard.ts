import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';

export const LOGIN_THROTTLER = 'login';

/**
 * Rate limit for credential endpoints: counts attempts per IP + email
 * (5 per minute, then a 15-minute block; see section 7 of the plan).
 * Applied per route with @UseGuards; there is no global throttler.
 */
@Injectable()
export class LoginThrottlerGuard extends ThrottlerGuard {
  protected override async getTracker(req: Record<string, unknown>): Promise<string> {
    const request = req as unknown as Request;
    const body = request.body as { email?: unknown } | undefined;
    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
    return `${request.ip ?? 'unknown'}|${email}`;
  }
}
