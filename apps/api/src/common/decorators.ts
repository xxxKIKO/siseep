import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import type { AppAbility } from '@siseep/shared';
import type { AuthenticatedRequest, RequestUser } from './request-user';

export const IS_PUBLIC_KEY = 'isPublic';
/** Skips JwtAuthGuard (and PoliciesGuard) for a route or controller. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export type PolicyHandler = (ability: AppAbility, request: AuthenticatedRequest) => boolean;
export const CHECK_POLICIES_KEY = 'checkPolicies';
/** Declares the CASL checks a route needs. All handlers must return true. */
export const CheckPolicies = (...handlers: PolicyHandler[]) =>
  SetMetadata(CHECK_POLICIES_KEY, handlers);

/** Injects the authenticated user (set by JwtAuthGuard). */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): RequestUser => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    return request.user;
  },
);
