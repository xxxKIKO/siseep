import {
  type Action,
  type AppAbility,
  abilityFromRules,
  subject,
  type SubjectName,
} from '@siseep/shared';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useLocation } from 'react-router';
import { api } from '@/lib/api-client';
import { useAuth } from './auth-context';

/**
 * CASL ability of the signed-in user, from the same rules the API applies (roles, assignments
 * and active permission grants). It only hides buttons: the API checks every request again.
 */
export function useAbility(): { ability: AppAbility; ready: boolean } {
  const { user } = useAuth();
  const rules = useQuery({
    queryKey: ['auth', 'abilities', user?.id ?? ''],
    enabled: Boolean(user),
    queryFn: () => api.get<{ rules: unknown[] }>('/auth/abilities'),
    staleTime: 60_000,
  });
  const ability = useMemo(() => abilityFromRules(rules.data?.rules ?? []), [rules.data]);
  return { ability, ready: rules.isSuccess };
}

/** `can('update', 'Grade', { groupId })` for a record of the user's school. */
export function useCan() {
  const { user } = useAuth();
  const { ability, ready } = useAbility();
  return {
    ready,
    can: (
      action: Action,
      name: Exclude<SubjectName, 'all'>,
      fields: Record<string, unknown> = {},
    ) => ability.can(action, subject(name, { schoolId: user?.schoolId, ...fields })),
  };
}

/** "/maestro" or "/director": teacher screens are reused read-only in the director portal. */
export function usePortalBase(): '/maestro' | '/director' | '/admin' {
  const { pathname } = useLocation();
  if (pathname.startsWith('/director')) return '/director';
  if (pathname.startsWith('/admin')) return '/admin';
  return '/maestro';
}
