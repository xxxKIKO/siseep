import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { type AccessTokenPayload, UserStatus } from '@siseep/shared';
import { Errors } from '../common/app.exception';
import { IS_PUBLIC_KEY } from '../common/decorators';
import type { AuthenticatedRequest } from '../common/request-user';
import { UsersService } from '../users/users.service';
import { SessionsService } from './sessions.service';

/**
 * Global guard: every route needs a valid access token unless marked @Public().
 * It also checks that the session was not revoked and the user is still active,
 * so logout and "close all sessions" take effect immediately.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly users: UsersService,
    private readonly sessions: SessionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = extractBearer(request.headers.authorization);
    if (!token) throw Errors.unauthorized();

    let payload: AccessTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<AccessTokenPayload>(token, { algorithms: ['HS256'] });
    } catch {
      throw Errors.unauthorized('Tu sesión venció. Vuelve a intentarlo.');
    }

    const [sessionActive, user] = await Promise.all([
      this.sessions.isActive(payload.sid, payload.sub),
      this.users.findById(payload.sub),
    ]);
    if (!sessionActive || !user || user.status !== UserStatus.ACTIVE) {
      throw Errors.unauthorized();
    }

    request.user = {
      id: user._id.toString(),
      schoolId: user.schoolId.toString(),
      roles: user.roles,
      sessionId: payload.sid,
      doc: user,
    };
    return true;
  }
}

function extractBearer(header: string | undefined): string | null {
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  return scheme?.toLowerCase() === 'bearer' && token ? token : null;
}
