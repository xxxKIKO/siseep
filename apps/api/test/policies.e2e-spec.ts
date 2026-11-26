import type { Role } from '@siseep/shared';
import { createTestContext, DEFAULT_PASSWORD, type TestContext } from './helpers';

// Permission tests: never delete or skip (see CLAUDE.md).
describe('Authorization (e2e)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestContext();
  });

  afterAll(async () => {
    await ctx.close();
  });

  async function tokenFor(roles: Role[]): Promise<string> {
    const user = await ctx.createUser(roles);
    const res = await ctx
      .http()
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: DEFAULT_PASSWORD });
    expect(res.status).toBe(200);
    return res.body.accessToken as string;
  }

  function inviteStaff(token: string) {
    return ctx
      .http()
      .post('/api/v1/invitations/staff')
      .set('Authorization', `Bearer ${token}`)
      .send({ email: `invitado-${Date.now()}-${Math.random()}@prueba.mx`, roles: ['TEACHER'] });
  }

  it('TEACHER receives 403 on an ADMIN route', async () => {
    const res = await inviteStaff(await tokenFor(['TEACHER']));
    expect(res.status).toBe(403);
    expect(res.body).toEqual({
      statusCode: 403,
      code: 'FORBIDDEN',
      message: 'No tienes permiso para realizar esta acción.',
    });
  });

  it.each<[Role[]]>([[['DIRECTOR']], [['GUARDIAN']], [['DIRECTOR', 'TEACHER']]])(
    '%j receives 403 on an ADMIN route',
    async (roles) => {
      expect((await inviteStaff(await tokenFor(roles))).status).toBe(403);
    },
  );

  it('ADMIN can use the ADMIN route', async () => {
    expect((await inviteStaff(await tokenFor(['ADMIN']))).status).toBe(201);
  });

  it('a user with ADMIN among several roles can use it', async () => {
    expect((await inviteStaff(await tokenFor(['TEACHER', 'ADMIN']))).status).toBe(201);
  });

  it('an anonymous request receives 401, not 403', async () => {
    const res = await ctx
      .http()
      .post('/api/v1/invitations/staff')
      .send({ email: 'x@prueba.mx', roles: ['TEACHER'] });
    expect(res.status).toBe(401);
  });
});
