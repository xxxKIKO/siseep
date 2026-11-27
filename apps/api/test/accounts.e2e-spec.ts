import type { CreatedAccountView, User } from '@siseep/shared';
import type request from 'supertest';
import { UsersService } from '../src/users/users.service';
import { createTestContext, type TestContext } from './helpers';
import { type SchoolSetup, setupSchool } from './school-setup';

/** 1×1 PNG. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

// Permission tests: never delete or skip (see CLAUDE.md).
describe('Accounts: usernames, profile, photo and staff created by the direction (e2e)', () => {
  let ctx: TestContext;
  let school: SchoolSetup;
  let admin: string;
  let director: string;
  let viry: string;

  const as = (token: string) => {
    const auth = (req: request.Test) => req.set('Authorization', `Bearer ${token}`);
    return {
      get: (path: string) => auth(ctx.http().get(`/api/v1${path}`)),
      post: (path: string, body?: object) => auth(ctx.http().post(`/api/v1${path}`)).send(body),
      patch: (path: string, body?: object) => auth(ctx.http().patch(`/api/v1${path}`)).send(body),
      put: (path: string) => auth(ctx.http().put(`/api/v1${path}`)),
      delete: (path: string) => auth(ctx.http().delete(`/api/v1${path}`)),
    };
  };
  const login = (username: string, password: string) =>
    ctx.http().post('/api/v1/auth/login').send({ username, password });

  beforeAll(async () => {
    ctx = await createTestContext();
    school = await setupSchool(ctx);
    admin = school.adminToken;
    director = await ctx.token(school.director);
    viry = await ctx.token(school.viry);
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('usernames: prefix of the main role + 2-digit year + consecutive, unique', async () => {
    expect(school.admin.username).toMatch(/^ADM\d{2}-\d{4}$/);
    expect(school.director.username).toMatch(/^DIR\d{2}-\d{4}$/);
    expect(school.viry.username).toMatch(/^MAE\d{2}-\d{4}$/);
    const teachers = [school.viry, school.otherTeacher, school.englishTeacher].map(
      (u) => u.username,
    );
    expect(new Set(teachers).size).toBe(3);
    // Accounts from before usernames get one at start-up.
    await ctx.connection.collection('users').updateOne(
      { _id: new (await import('mongoose')).Types.ObjectId(school.viry.id) },
      {
        $unset: { username: '' },
      },
    );
    expect(await ctx.app.get(UsersService).ensureUsernames()).toBe(1);
    const me = await as(viry).get('/auth/me');
    expect(me.body.username).toMatch(/^MAE\d{2}-\d{4}$/);
    expect(me.body.username).not.toBe(school.viry.username);
    school.viry.username = me.body.username as string;
  });

  it('the direction creates a teacher with a temporary password; never admins or directors', async () => {
    const res = await as(director).post('/users', {
      firstName: 'Nueva',
      lastName: 'Maestra',
      roles: ['TEACHER'],
      phone: '3121231234',
    });
    expect(res.status).toBe(201);
    const created = res.body as CreatedAccountView;
    expect(created.username).toMatch(/^MAE\d{2}-\d{4}$/);
    expect(created.user).toMatchObject({ email: null, mustChangePassword: true });

    for (const roles of [['ADMIN'], ['DIRECTOR'], ['TEACHER', 'DIRECTOR']]) {
      expect((await as(director).post('/users', { firstName: 'X', roles })).status).toBe(400);
    }
    expect((await as(viry).post('/users', { firstName: 'X', roles: ['TEACHER'] })).status).toBe(
      403,
    );
    expect(
      (await as(admin).post('/users', { firstName: 'Otra', roles: ['DIRECTOR'] })).status,
    ).toBe(201);

    // First sign-in: only the password change is allowed.
    const first = await login(created.username, created.temporaryPassword!);
    expect(first.status).toBe(200);
    const token = first.body.accessToken as string;
    expect((await as(token).get('/groups')).body.code).toBe('PASSWORD_CHANGE_REQUIRED');
    expect(
      (
        await as(token).post('/me/password', {
          currentPassword: created.temporaryPassword,
          newPassword: 'mi-contraseña-nueva',
        })
      ).status,
    ).toBe(200);
    expect((await as(token).get('/groups')).status).toBe(200);
  });

  it('the direction removes (disables) teachers and lists accounts; never touches admins', async () => {
    const list = await as(director).get('/users?role=TEACHER');
    expect(list.status).toBe(200);
    expect(list.body.total).toBeGreaterThanOrEqual(4);
    expect((await as(director).post(`/users/${school.otherTeacher.id}/disable`)).status).toBe(200);
    expect((await as(director).post(`/users/${school.otherTeacher.id}/enable`)).status).toBe(200);
    expect((await as(director).post(`/users/${school.admin.id}/disable`)).status).toBe(403);
    expect((await as(director).post(`/users/${school.admin.id}/reset-password`)).status).toBe(403);
    expect((await as(viry).get('/users')).status).toBe(403);
  });

  it('the direction assigns a teacher to a group', async () => {
    const res = await as(director).post(`/groups/${school.group4A.id}/assignments`, {
      teacherId: school.viry.id,
      scope: 'SUBJECT',
      subjectKey: 'ed_fisica',
    });
    expect([200, 201]).toContain(res.status);
  });

  it('everyone edits their own profile (name, email, phone, address)', async () => {
    const res = await as(viry).patch('/me', {
      firstName: 'Virginia',
      lastName: 'Ramírez',
      email: 'Viry@Escuela.mx',
      phone: '312 555 1212',
      address: 'Av. Siempre Viva 10',
    });
    expect(res.status).toBe(200);
    expect(res.body as User).toMatchObject({
      firstName: 'Virginia',
      email: 'viry@escuela.mx',
      phone: '3125551212',
      address: 'Av. Siempre Viva 10',
    });
    // An email of another account: 409.
    expect(
      (await as(director).patch('/me', { firstName: 'D', lastName: '', email: 'viry@escuela.mx' }))
        .status,
    ).toBe(409);
    // Optional email: it can be removed.
    expect(
      (await as(viry).patch('/me', { firstName: 'Virginia', lastName: 'Ramírez', email: '' })).body
        .email,
    ).toBeNull();
  });

  it('profile photo: upload, read and remove (PNG/JPG only)', async () => {
    const upload = await as(viry).put('/me/photo').attach('file', PNG, 'foto.png');
    expect(upload.status).toBe(200);
    expect(upload.body.hasPhoto).toBe(true);
    const photo = await as(viry).get('/me/photo');
    expect(photo.status).toBe(200);
    expect(photo.headers['content-type']).toBe('image/png');
    const bad = await as(viry).put('/me/photo').attach('file', Buffer.from('hola'), 'foto.txt');
    expect(bad.status).toBe(400);
    expect((await as(viry).delete('/me/photo')).body.hasPhoto).toBe(false);
    expect((await as(viry).get('/me/photo')).status).toBe(404);
  });
});
