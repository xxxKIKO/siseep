import {
  createTestContext,
  DEFAULT_PASSWORD,
  rawSetCookie,
  refreshCookieFrom,
  type TestContext,
} from './helpers';

describe('Auth (e2e)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestContext();
  });

  afterAll(async () => {
    await ctx.close();
  });

  /** Moves every rotation 2 minutes into the past, beyond REFRESH_REUSE_GRACE_SECONDS (60). */
  async function expireReuseGrace() {
    await ctx.connection
      .collection('sessions')
      .updateMany(
        { rotatedAt: { $ne: null } },
        { $set: { rotatedAt: new Date(Date.now() - 120_000) } },
      );
  }

  async function login(email: string, password = DEFAULT_PASSWORD) {
    return ctx.http().post('/api/v1/auth/login').send({ email, password });
  }

  describe('POST /auth/login', () => {
    it('returns an access token and sets a secure httpOnly refresh cookie', async () => {
      const user = await ctx.createUser(['TEACHER']);
      const res = await login(user.email.toUpperCase());

      expect(res.status).toBe(200);
      expect(res.body.accessToken).toEqual(expect.any(String));
      expect(res.body.expiresIn).toBe(900);
      expect(res.body.user).toMatchObject({ id: user.id, email: user.email, roles: ['TEACHER'] });
      expect(res.body.user.passwordHash).toBeUndefined();

      const cookie = rawSetCookie(res);
      expect(cookie).toBeDefined();
      expect(cookie).toMatch(/HttpOnly/i);
      expect(cookie).toMatch(/Secure/i);
      expect(cookie).toMatch(/SameSite=Strict/i);
      expect(cookie).toMatch(/Path=\/api\/v1\/auth/);
      expect(cookie).toMatch(/Expires=/);
    });

    it('rejects a wrong password with a Spanish error', async () => {
      const user = await ctx.createUser(['TEACHER']);
      const res = await login(user.email, 'contraseña-incorrecta');

      expect(res.status).toBe(401);
      expect(res.body).toEqual({
        statusCode: 401,
        code: 'INVALID_CREDENTIALS',
        message: 'Correo o contraseña incorrectos.',
      });
      expect(refreshCookieFrom(res)).toBeUndefined();
    });

    it('rejects an unknown email with the same error', async () => {
      const res = await login('nadie@prueba.mx');
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('INVALID_CREDENTIALS');
    });

    it('returns VALIDATION_ERROR with details for an invalid body', async () => {
      const res = await ctx.http().post('/api/v1/auth/login').send({ email: 'no-es-correo' });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(res.body.details).toEqual(
        expect.arrayContaining([expect.objectContaining({ path: 'email' })]),
      );
    });

    it('blocks the 6th attempt in a minute for the same IP and email', async () => {
      const user = await ctx.createUser(['TEACHER']);
      for (let attempt = 1; attempt <= 5; attempt += 1) {
        const res = await login(user.email, 'contraseña-incorrecta');
        expect(res.status).toBe(401);
      }
      const blocked = await login(user.email, DEFAULT_PASSWORD);
      expect(blocked.status).toBe(429);
      expect(blocked.body.code).toBe('TOO_MANY_REQUESTS');

      // Another email from the same IP is not affected.
      const other = await ctx.createUser(['TEACHER']);
      expect((await login(other.email)).status).toBe(200);
    });
  });

  describe('GET /auth/me', () => {
    it('returns the current user with a valid token', async () => {
      const user = await ctx.createUser(['DIRECTOR', 'TEACHER']);
      const { body } = await login(user.email);
      const res = await ctx
        .http()
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${body.accessToken}`);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: user.id, roles: ['DIRECTOR', 'TEACHER'] });
    });

    it('returns 401 without a token or with a forged one', async () => {
      const noToken = await ctx.http().get('/api/v1/auth/me');
      expect(noToken.status).toBe(401);
      expect(noToken.body.code).toBe('UNAUTHORIZED');

      const forged = await ctx
        .http()
        .get('/api/v1/auth/me')
        .set('Authorization', 'Bearer eyJhbGciOiJub25lIn0.eyJzdWIiOiIxIn0.');
      expect(forged.status).toBe(401);
    });
  });

  describe('POST /auth/refresh', () => {
    it('rotates the refresh token on every use', async () => {
      const user = await ctx.createUser(['TEACHER']);
      const first = refreshCookieFrom(await login(user.email));

      const res = await ctx.http().post('/api/v1/auth/refresh').set('Cookie', first!);
      expect(res.status).toBe(200);
      expect(res.body.accessToken).toEqual(expect.any(String));
      expect(res.body.user.id).toBe(user.id);
      const second = refreshCookieFrom(res);
      expect(second).toBeDefined();
      expect(second).not.toBe(first);

      const again = await ctx.http().post('/api/v1/auth/refresh').set('Cookie', second!);
      expect(again.status).toBe(200);
    });

    it('revokes every session of the user when an old refresh token is reused', async () => {
      const user = await ctx.createUser(['TEACHER']);
      const loginA = await login(user.email);
      const oldCookie = refreshCookieFrom(loginA)!;
      const otherDevice = refreshCookieFrom(await login(user.email))!;

      const rotated = await ctx.http().post('/api/v1/auth/refresh').set('Cookie', oldCookie);
      const newCookie = refreshCookieFrom(rotated)!;
      const newAccess = rotated.body.accessToken as string;

      // The reuse grace period (lost responses) is over.
      await expireReuseGrace();
      const reuse = await ctx.http().post('/api/v1/auth/refresh').set('Cookie', oldCookie);
      expect(reuse.status).toBe(401);
      expect(reuse.body.code).toBe('REFRESH_TOKEN_REUSED');

      // The legitimate new token, the other device and the access token all stop working.
      expect((await ctx.http().post('/api/v1/auth/refresh').set('Cookie', newCookie)).status).toBe(
        401,
      );
      expect(
        (await ctx.http().post('/api/v1/auth/refresh').set('Cookie', otherDevice)).status,
      ).toBe(401);
      expect(
        (await ctx.http().get('/api/v1/auth/me').set('Authorization', `Bearer ${newAccess}`))
          .status,
      ).toBe(401);
    });

    it('a lost refresh response does not log the user out (reuse grace period)', async () => {
      const user = await ctx.createUser(['TEACHER']);
      const first = refreshCookieFrom(await login(user.email))!;

      // The server rotates, but the browser never receives the new cookie (tab reloaded).
      const lost = await ctx.http().post('/api/v1/auth/refresh').set('Cookie', first);
      expect(lost.status).toBe(200);

      // Seconds later the browser sends the old cookie again: accepted and rotated.
      const retry = await ctx.http().post('/api/v1/auth/refresh').set('Cookie', first);
      expect(retry.status).toBe(200);
      const current = refreshCookieFrom(retry)!;
      expect((await ctx.http().post('/api/v1/auth/refresh').set('Cookie', current)).status).toBe(
        200,
      );

      // The secret two rotations back is no longer "previous": reuse → everything revoked.
      const stale = await ctx.http().post('/api/v1/auth/refresh').set('Cookie', first);
      expect(stale.status).toBe(401);
      expect(stale.body.code).toBe('REFRESH_TOKEN_REUSED');
    });

    it('returns 401 without a cookie or with garbage', async () => {
      expect((await ctx.http().post('/api/v1/auth/refresh')).status).toBe(401);
      const garbage = await ctx
        .http()
        .post('/api/v1/auth/refresh')
        .set('Cookie', 'siseep_rt=no-es-un-token');
      expect(garbage.status).toBe(401);
      expect(garbage.body.code).toBe('INVALID_REFRESH_TOKEN');
    });
  });

  describe('logout', () => {
    it('POST /auth/logout revokes this session and clears the cookie', async () => {
      const user = await ctx.createUser(['TEACHER']);
      const res = await login(user.email);
      const cookie = refreshCookieFrom(res)!;
      const access = res.body.accessToken as string;

      const out = await ctx.http().post('/api/v1/auth/logout').set('Cookie', cookie);
      expect(out.status).toBe(204);
      expect(rawSetCookie(out)).toMatch(/siseep_rt=;/);

      const refresh = await ctx.http().post('/api/v1/auth/refresh').set('Cookie', cookie);
      expect(refresh.status).toBe(401);
      expect(refresh.body.code).toBe('INVALID_REFRESH_TOKEN');
      expect(
        (await ctx.http().get('/api/v1/auth/me').set('Authorization', `Bearer ${access}`)).status,
      ).toBe(401);
    });

    it('POST /auth/logout-all revokes every device', async () => {
      const user = await ctx.createUser(['TEACHER']);
      const phone = await login(user.email);
      const laptop = await login(user.email);

      const out = await ctx
        .http()
        .post('/api/v1/auth/logout-all')
        .set('Authorization', `Bearer ${phone.body.accessToken}`);
      expect(out.status).toBe(204);

      for (const session of [phone, laptop]) {
        const refresh = await ctx
          .http()
          .post('/api/v1/auth/refresh')
          .set('Cookie', refreshCookieFrom(session)!);
        expect(refresh.status).toBe(401);
      }
    });

    it('POST /auth/logout-all requires authentication', async () => {
      expect((await ctx.http().post('/api/v1/auth/logout-all')).status).toBe(401);
    });
  });

  describe('password reset', () => {
    it('emails a 1-hour link, changes the password and closes other sessions', async () => {
      const user = await ctx.createUser(['TEACHER']);
      const oldSession = refreshCookieFrom(await login(user.email))!;

      const forgot = await ctx.http().post('/api/v1/auth/forgot').send({ email: user.email });
      expect(forgot.status).toBe(204);
      const mail = ctx.mail.lastTo(user.email);
      expect(mail?.text).toContain('vence en 60 minutos');
      const token = new URL(mail!.text.match(/http\S+/)![0]).searchParams.get('token')!;

      const newPassword = 'nueva-contraseña-123';
      const reset = await ctx
        .http()
        .post('/api/v1/auth/reset')
        .send({ token, password: newPassword });
      expect(reset.status).toBe(204);

      expect((await login(user.email, newPassword)).status).toBe(200);
      expect((await ctx.http().post('/api/v1/auth/refresh').set('Cookie', oldSession)).status).toBe(
        401,
      );

      const reused = await ctx
        .http()
        .post('/api/v1/auth/reset')
        .send({ token, password: 'otra-contraseña-456' });
      expect(reused.status).toBe(400);
      expect(reused.body.code).toBe('INVALID_TOKEN');
    });

    it('answers 204 for unknown emails without sending anything', async () => {
      const before = ctx.mail.sent.length;
      const res = await ctx.http().post('/api/v1/auth/forgot').send({ email: 'nadie@prueba.mx' });
      expect(res.status).toBe(204);
      expect(ctx.mail.sent.length).toBe(before);
    });

    it('rejects passwords shorter than 10 characters', async () => {
      const res = await ctx
        .http()
        .post('/api/v1/auth/reset')
        .send({ token: 'x'.repeat(43), password: 'corta' });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('staff invitations', () => {
    it('lets an invited person create their account once', async () => {
      const admin = await ctx.createUser(['ADMIN']);
      const { body: auth } = await login(admin.email);

      const invite = await ctx
        .http()
        .post('/api/v1/invitations/staff')
        .set('Authorization', `Bearer ${auth.accessToken}`)
        .send({ email: 'Nueva.Maestra@Prueba.mx', roles: ['TEACHER'] });
      expect(invite.status).toBe(201);
      expect(invite.body).toMatchObject({ email: 'nueva.maestra@prueba.mx', roles: ['TEACHER'] });

      const mail = ctx.mail.lastTo('nueva.maestra@prueba.mx');
      const code = new URL(mail!.text.match(/http\S+/)![0]).searchParams.get('codigo')!;

      const accepted = await ctx.http().post('/api/v1/auth/accept-invite').send({
        code,
        firstName: 'Ana',
        lastName: 'López',
        password: 'contraseña-de-ana',
      });
      expect(accepted.status).toBe(200);
      expect(accepted.body.user).toMatchObject({
        email: 'nueva.maestra@prueba.mx',
        roles: ['TEACHER'],
        schoolId: admin.schoolId,
        status: 'ACTIVE',
      });
      expect(refreshCookieFrom(accepted)).toBeDefined();

      const again = await ctx.http().post('/api/v1/auth/accept-invite').send({
        code,
        firstName: 'Ana',
        lastName: 'López',
        password: 'contraseña-de-ana',
      });
      expect(again.status).toBe(400);
      expect(again.body.code).toBe('INVALID_INVITATION');
    });

    it('rejects an invitation for an email that already has an account', async () => {
      const admin = await ctx.createUser(['ADMIN']);
      const existing = await ctx.createUser(['TEACHER']);
      const { body: auth } = await login(admin.email);
      const res = await ctx
        .http()
        .post('/api/v1/invitations/staff')
        .set('Authorization', `Bearer ${auth.accessToken}`)
        .send({ email: existing.email, roles: ['DIRECTOR'] });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('CONFLICT');
    });
  });

  describe('errors and health', () => {
    it('returns the standard error shape for unknown routes', async () => {
      const user = await ctx.createUser(['ADMIN']);
      const { body } = await login(user.email);
      const res = await ctx
        .http()
        .get('/api/v1/no-existe')
        .set('Authorization', `Bearer ${body.accessToken}`);
      expect(res.status).toBe(404);
      expect(res.body).toEqual({
        statusCode: 404,
        code: 'NOT_FOUND',
        message: 'No encontramos lo que buscas.',
      });
    });

    it('GET /health is public', async () => {
      const res = await ctx.http().get('/api/v1/health');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: 'ok', db: 'up' });
      expect(res.headers['x-robots-tag']).toBe('noindex, nofollow');
    });
  });
});
