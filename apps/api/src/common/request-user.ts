import type { AppAbility, AuthUser } from '@siseep/shared';
import type { Request } from 'express';
import type { UserDocument } from '../users/user.schema';

/** Identity attached to the request by JwtAuthGuard. */
export interface RequestUser extends AuthUser {
  sessionId: string;
  doc: UserDocument;
}

export interface AuthenticatedRequest extends Request {
  user: RequestUser;
  ability?: AppAbility;
}
