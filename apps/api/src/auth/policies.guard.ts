import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { defineAbilityFor, Role } from '@siseep/shared';
import { Errors } from '../common/app.exception';
import { CHECK_POLICIES_KEY, IS_PUBLIC_KEY, type PolicyHandler } from '../common/decorators';
import type { AuthenticatedRequest } from '../common/request-user';
import { PermissionGrantsService } from '../permission-grants/permission-grants.service';

/**
 * Global guard that runs after JwtAuthGuard. Builds the CASL ability from the shared rules
 * (roles + active permission grants) and evaluates the route's @CheckPolicies handlers.
 * The ability stays on `request.ability` for services that need scope checks.
 */
@Injectable()
export class PoliciesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly grants: PermissionGrantsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) return true;

    const handlers = this.reflector.getAllAndOverride<PolicyHandler[] | undefined>(
      CHECK_POLICIES_KEY,
      targets,
    );
    if (!handlers || handlers.length === 0) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.user;
    if (!user) throw Errors.unauthorized();

    const grants = user.roles.includes(Role.ADMIN) ? [] : await this.grants.findActiveForUser(user);
    const ability = defineAbilityFor(user, grants);
    request.ability = ability;

    if (!handlers.every((handler) => handler(ability, request))) throw Errors.forbidden();
    return true;
  }
}
