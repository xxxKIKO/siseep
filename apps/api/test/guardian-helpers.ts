import type { CreatedAccountView } from '@siseep/shared';
import type { TestContext } from './helpers';

export const FAMILY_PASSWORD = 'contraseña-de-familia';

export interface GuardianData {
  firstName?: string;
  lastName?: string;
  phone: string;
  relationship?: string;
  address?: string;
  email?: string;
}

/** POST /students/:id/guardians as `token` (teacher, director or admin). */
export function createGuardian(
  ctx: TestContext,
  token: string,
  studentId: string,
  data: GuardianData,
) {
  return ctx
    .http()
    .post(`/api/v1/students/${studentId}/guardians`)
    .set('Authorization', `Bearer ${token}`)
    .send({
      firstName: 'Laura',
      lastName: 'Familia',
      relationship: 'MADRE',
      address: 'Calle Falsa 123, Colima',
      ...data,
    });
}

/**
 * First sign-in of a guardian: logs in with the temporary password, chooses their own and
 * accepts the privacy notice. Returns the access token, ready for the portal.
 */
export async function activateGuardian(
  ctx: TestContext,
  account: Pick<CreatedAccountView, 'username' | 'temporaryPassword'>,
  newPassword = FAMILY_PASSWORD,
): Promise<string> {
  const login = await ctx
    .http()
    .post('/api/v1/auth/login')
    .send({ username: account.username, password: account.temporaryPassword });
  if (login.status !== 200) throw new Error(`login ${account.username} → ${login.status}`);
  const token = login.body.accessToken as string;
  const changed = await ctx
    .http()
    .post('/api/v1/me/password')
    .set('Authorization', `Bearer ${token}`)
    .send({ currentPassword: account.temporaryPassword, newPassword, acceptPrivacy: true });
  if (changed.status !== 200) throw new Error(`password ${account.username} → ${changed.status}`);
  return token;
}
