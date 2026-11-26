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
  /** Built by PoliciesGuard for every authenticated request. */
  ability?: AppAbility;
}

/** User + ability, the pair every scoped service method receives. */
export interface Actor {
  user: RequestUser;
  ability: AppAbility;
  /** Client IP, stored in the audit log. */
  ip?: string;
}
