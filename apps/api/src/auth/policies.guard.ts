import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AbilityFactory } from '../access/ability.factory';
import { Errors } from '../common/app.exception';
import { CHECK_POLICIES_KEY, IS_PUBLIC_KEY, type PolicyHandler } from '../common/decorators';
import type { AuthenticatedRequest } from '../common/request-user';

/**
 * Global guard that runs after JwtAuthGuard. Builds the CASL ability from the shared rules
 * (roles + active permission grants + teaching assignments), stores it on `request.ability`
 * for the scoped services, and evaluates the route's @CheckPolicies handlers.
 */
@Injectable()
export class PoliciesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly abilities: AbilityFactory,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.user;
    if (!user) throw Errors.unauthorized();

    const ability = await this.abilities.forUser(user);
    request.ability = ability;

    const handlers =
      this.reflector.getAllAndOverride<PolicyHandler[] | undefined>(CHECK_POLICIES_KEY, targets) ??
      [];
    if (!handlers.every((handler) => handler(ability, request))) throw Errors.forbidden();
    return true;
  }
}
