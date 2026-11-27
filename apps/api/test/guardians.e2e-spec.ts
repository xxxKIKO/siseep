import type {
  ActivityView,
  AuditLogView,
  ChildActivity,
  ChildNote,
  ChildOverview,
  ChildReportCard,
  ChildView,
  CreatedAccountView,
  GroupGuardianRow,
  ImportPreview,
  Paginated,
  PeriodResultsView,
} from '@siseep/shared';
import type request from 'supertest';
import { findChromium } from '../src/reports/pdf.service';
import { fixtureBuffer } from './fixture';
import { activateGuardian, createGuardian, FAMILY_PASSWORD } from './guardian-helpers';
import { createTestContext, type TestContext } from './helpers';
import { type SchoolSetup, setupSchool } from './school-setup';

const binary = (req: request.Test) =>
  req.buffer(true).parse((res, cb) => {
    const chunks: Buffer[] = [];
    res.on('data', (chunk: Buffer) => chunks.push(chunk));
    res.on('end', () => cb(null, Buffer.concat(chunks)));
  });

const PHONE_A = '3121112233';
const PHONE_B = '3124445566';

// Permission tests: never delete or skip (see CLAUDE.md).
describe('Guardian accounts, guardian portal and director (e2e)', () => {
  let ctx: TestContext;
  let school: SchoolSetup;
  let admin: string;
  let viry: string;
  let director: string;
  let english: string;
  let other: string;
  let students: PeriodResultsView['rows'];

  const as = (token: string) => {
    const auth = (req: request.Test) => req.set('Authorization', `Bearer ${token}`);
    return {
      get: (path: string) => auth(ctx.http().get(`/api/v1${path}`)),
      post: (path: string, body?: object) => auth(ctx.http().post(`/api/v1${path}`)).send(body),
      put: (path: string, body?: object) => auth(ctx.http().put(`/api/v1${path}`)).send(body),
      delete: (path: string) => auth(ctx.http().delete(`/api/v1${path}`)),
    };
  };

  // Two families: A (N/L 1 and N/L 2, same phone) and B (N/L 3 and N/L 5).
  let guardianA: string;
  let guardianB: string;
  let accountA: CreatedAccountView;
  const child = (listNumber: number) => students.find((s) => s.student.listNumber === listNumber)!;

  beforeAll(async () => {
    ctx = await createTestContext();
    school = await setupSchool(ctx);
    admin = school.adminToken;
    const preview = await ctx
      .http()
      .post('/api/v1/imports/excel/preview')
      .set('Authorization', `Bearer ${admin}`)
      .field('groupId', school.group5B.id)
      .field('periodId', school.period.id)
      .attach('file', fixtureBuffer(), 'excel.xlsx');
    await as(admin).post('/imports/excel/commit', {
      previewId: (preview.body as ImportPreview).previewId,
    });
    viry = await ctx.token(school.viry);
    director = await ctx.token(school.director);
    english = await ctx.token(school.englishTeacher);
    other = await ctx.token(school.otherTeacher);
    students = (
      (
        await as(viry).get(
          `/groups/${school.group5B.id}/period-results?periodId=${school.period.id}`,
        )
      ).body as PeriodResultsView
    ).rows;
  });

  afterAll(async () => {
    await ctx.close();
  });

  describe('guardian accounts', () => {
    it('the homeroom teacher creates the account: username TUT + year + consecutive and a temporary password', async () => {
      const res = await createGuardian(ctx, viry, child(1).student.id, {
        phone: '312 111 2233',
        email: 'laura@correo.mx',
      });
      expect(res.status).toBe(201);
      accountA = res.body as CreatedAccountView;
      expect(accountA.username).toMatch(/^TUT\d{2}-\d{4}$/);
      expect(accountA.temporaryPassword).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{2}$/);
      expect(accountA.existing).toBe(false);
      expect(accountA.user).toMatchObject({
        roles: ['GUARDIAN'],
        phone: PHONE_A,
        address: 'Calle Falsa 123, Colima',
        mustChangePassword: true,
      });
    });

    it('the same phone links a sibling to the same account (no new account, no password)', async () => {
      const res = await createGuardian(ctx, viry, child(2).student.id, {
        phone: '+52 312-111-2233',
        firstName: 'Otro nombre',
      });
      expect(res.status).toBe(201);
      const sibling = res.body as CreatedAccountView;
      expect(sibling).toMatchObject({ existing: true, temporaryPassword: null });
      expect(sibling.username).toBe(accountA.username);
      expect(sibling.children!.map((c) => c.id).sort()).toEqual(
        [child(1).student.id, child(2).student.id].sort(),
      );
      // Again for the same student: 409.
      expect(
        (await createGuardian(ctx, viry, child(2).student.id, { phone: PHONE_A })).status,
      ).toBe(409);
    });

    it('who can create guardian accounts: homeroom teacher, direction, admin; not others', async () => {
      for (const token of [other, english]) {
        expect(
          (await createGuardian(ctx, token, child(3).student.id, { phone: '3120000001' })).status,
        ).toBe(403);
      }
      const byDirector = await createGuardian(ctx, director, child(3).student.id, {
        phone: PHONE_B,
        relationship: 'PADRE',
        firstName: 'Mario',
      });
      expect(byDirector.status).toBe(201);
      const byAdmin = await createGuardian(ctx, admin, child(5).student.id, {
        phone: PHONE_B,
        relationship: 'PADRE',
      });
      expect(byAdmin.body).toMatchObject({ existing: true });
      guardianB = await activateGuardian(ctx, byDirector.body as CreatedAccountView);
    });

    it('validates the data: a 10-digit phone is required', async () => {
      const bad = await createGuardian(ctx, viry, child(6).student.id, { phone: '12345' });
      expect(bad.status).toBe(400);
    });

    it('a student has at most 4 guardians', async () => {
      const target = child(7).student.id;
      for (let i = 0; i < 4; i++) {
        const res = await createGuardian(ctx, viry, target, { phone: `31255500${10 + i}` });
        expect(res.status).toBe(201);
      }
      expect((await createGuardian(ctx, viry, target, { phone: '3125550099' })).status).toBe(409);
    });

    it('first sign-in: the temporary password only allows changing it (and accepting the privacy notice)', async () => {
      const login = await ctx
        .http()
        .post('/api/v1/auth/login')
        .send({ username: accountA.username.toLowerCase(), password: accountA.temporaryPassword });
      expect(login.status).toBe(200);
      expect(login.body.user.mustChangePassword).toBe(true);
      const token = login.body.accessToken as string;
      const blocked = await as(token).get('/me/children');
      expect(blocked.status).toBe(403);
      expect(blocked.body.code).toBe('PASSWORD_CHANGE_REQUIRED');
      expect((await as(token).get('/auth/me')).status).toBe(200);

      const noPrivacy = await as(token).post('/me/password', {
        currentPassword: accountA.temporaryPassword,
        newPassword: FAMILY_PASSWORD,
      });
      expect(noPrivacy.status).toBe(400);
      const wrong = await as(token).post('/me/password', {
        currentPassword: 'no-es-la-temporal',
        newPassword: FAMILY_PASSWORD,
        acceptPrivacy: true,
      });
      expect(wrong.status).toBe(400);
      const ok = await as(token).post('/me/password', {
        currentPassword: accountA.temporaryPassword,
        newPassword: FAMILY_PASSWORD,
        acceptPrivacy: true,
      });
      expect(ok.status).toBe(200);
      expect(ok.body).toMatchObject({ mustChangePassword: false, privacyAcceptedVersion: 1 });
      guardianA = token;
      expect((await as(guardianA).get('/me/children')).status).toBe(200);
    });

    it('the teacher resets a lost password: a new temporary one, the old one stops working', async () => {
      const otherAccount = (
        await createGuardian(ctx, viry, child(8).student.id, { phone: '3127778899' })
      ).body as CreatedAccountView;
      expect(
        (await as(other).post(`/guardians/${otherAccount.user.id}/reset-password`)).status,
      ).toBe(403);
      const reset = await as(viry).post(`/guardians/${otherAccount.user.id}/reset-password`);
      expect(reset.status).toBe(200);
      expect(reset.body.username).toBe(otherAccount.username);
      expect(reset.body.temporaryPassword).not.toBe(otherAccount.temporaryPassword);
      const old = await ctx
        .http()
        .post('/api/v1/auth/login')
        .send({ username: otherAccount.username, password: otherAccount.temporaryPassword });
      expect(old.status).toBe(401);
      // Staff accounts are never reset from here.
      expect((await as(viry).post(`/guardians/${school.viry.id}/reset-password`)).status).toBe(404);
    });

    it('the group list shows each student with their guardians (username, phone, activated)', async () => {
      const res = await as(viry).get(`/groups/${school.group5B.id}/guardians`);
      expect(res.status).toBe(200);
      const rows = res.body as GroupGuardianRow[];
      expect(rows).toHaveLength(20);
      const first = rows.find((r) => r.student.id === child(1).student.id)!;
      expect(first.status).toBe('LINKED');
      expect(first.links[0]!.guardian).toMatchObject({
        username: accountA.username,
        phone: PHONE_A,
        activated: true,
      });
      expect(rows.find((r) => r.student.id === child(9).student.id)!.status).toBe('NONE');
      expect((await as(other).get(`/groups/${school.group5B.id}/guardians`)).status).toBe(403);
      expect((await as(director).get(`/groups/${school.group5B.id}/guardians`)).status).toBe(200);
    });
  });

  describe('guardian portal', () => {
    const paths = (studentId: string) => [
      `/me/children/${studentId}/overview?periodId=${school.period.id}`,
      `/me/children/${studentId}/activities?periodId=${school.period.id}`,
      `/me/children/${studentId}/notes?periodId=${school.period.id}`,
      `/me/children/${studentId}/report-cards`,
      `/me/children/${studentId}/report-card.pdf?periodId=${school.period.id}`,
    ];

    it('family A sees both children; family B only theirs', async () => {
      const a = (await as(guardianA).get('/me/children')).body as ChildView[];
      expect(a).toHaveLength(2);
      expect(a[0]).toMatchObject({ group: { name: '5°B' }, relationship: 'MADRE' });
      expect(a[0]!.periods[0]).toMatchObject({ name: 'Periodo I', status: 'OPEN' });
      const b = (await as(guardianB).get('/me/children')).body as ChildView[];
      expect(b.map((c) => c.id).sort()).toEqual([child(3).student.id, child(5).student.id].sort());
    });

    it('isolation: family B gets 404 on every endpoint for a child of family A', async () => {
      for (const path of paths(child(1).student.id)) {
        expect((await as(guardianB).get(path)).status).toBe(404);
      }
      // Unknown or malformed ids are 404 too.
      for (const path of paths('0123456789abcdef01234567')) {
        expect((await as(guardianA).get(path)).status).toBe(404);
      }
      expect((await as(guardianA).get('/me/children/xyz/activities?periodId=x')).status).toBe(404);
      // Staff cannot use the guardian portal; guardians cannot use staff endpoints.
      expect((await as(viry).get('/me/children')).status).toBe(403);
      expect((await as(director).get('/me/children')).status).toBe(403);
      expect(
        (
          await as(guardianA).get(
            `/groups/${school.group5B.id}/summary?periodId=${school.period.id}`,
          )
        ).status,
      ).toBe(403);
      expect((await as(guardianA).get(`/students/${child(1).student.id}/notes`)).status).toBe(403);
    });

    it('overview: only this student, no group averages; "Necesita apoyo" under 7', async () => {
      const res = await as(guardianA).get(paths(child(2).student.id)[0]!);
      expect(res.status).toBe(200);
      const overview = res.body as ChildOverview;
      expect(overview.fields).toHaveLength(4);
      // N/L 2 is low in Saberes and Ética in the fixture.
      expect(overview.supportMessage).toMatch(/^Necesita apoyo en .*Saberes.*Ética/);
      expect(overview.weekly.length).toBeGreaterThan(0);
      const text = JSON.stringify(overview);
      expect(text).not.toContain(child(1).student.id);
      expect(text).not.toMatch(/generalAverage|stats|students/);
    });

    it('activities: hidden until visibleFrom and when not visible to guardians', async () => {
      const before = (await as(guardianA).get(paths(child(1).student.id)[1]!))
        .body as ChildActivity[];
      expect(before).toHaveLength(30);
      expect(before.every((a) => a.grade !== null)).toBe(true);
      // New activities: visible in 24 h by default, and one never visible.
      const later = (
        await as(viry).post('/activities', {
          groupId: school.group5B.id,
          periodId: school.period.id,
          fieldKey: 'saberes',
          component: 'DESEMPENO',
          name: 'Tarea de mañana',
          date: '2026-11-20',
        })
      ).body as ActivityView;
      expect(new Date(later.visibleFrom).getTime()).toBeGreaterThan(Date.now());
      const hidden = await as(viry).post('/activities', {
        groupId: school.group5B.id,
        periodId: school.period.id,
        fieldKey: 'saberes',
        component: 'DESEMPENO',
        name: 'Interna',
        date: '2026-11-20',
        visibleToGuardians: false,
      });
      expect(hidden.status).toBe(201);
      const after = (await as(guardianA).get(paths(child(1).student.id)[1]!))
        .body as ChildActivity[];
      expect(after).toHaveLength(30);
      expect(after.some((a) => a.name === 'Tarea de mañana' || a.name === 'Interna')).toBe(false);
      await as(viry).delete(`/activities/${later.id}`);
      await as(viry).delete(`/activities/${(hidden.body as ActivityView).id}`);
    });

    it('notes: only visible ones, never SALUD', async () => {
      const studentId = child(1).student.id;
      const note = (kind: string, text: string, visibleToGuardians: boolean) =>
        as(viry).post(`/students/${studentId}/notes`, {
          kind,
          text,
          date: '2026-11-20',
          visibleToGuardians,
        });
      expect((await note('RECONOCIMIENTO', 'Ayudó a un compañero.', true)).status).toBe(201);
      expect((await note('CONDUCTA', 'Interna para la dirección.', false)).status).toBe(201);
      expect((await note('SALUD', 'Alergia a la nuez.', true)).status).toBe(201);
      const res = await as(guardianA).get(paths(studentId)[2]!);
      expect(res.status).toBe(200);
      const notes = res.body as ChildNote[];
      expect(notes.map((n) => n.text)).toEqual(['Ayudó a un compañero.']);
      // Family B never sees them.
      expect((await as(guardianB).get(paths(studentId)[2]!)).status).toBe(404);
    });

    it('report cards: nothing until the period is PUBLISHED', async () => {
      const studentId = child(1).student.id;
      expect((await as(guardianA).get(paths(studentId)[3]!)).body).toEqual([]);
      expect((await as(guardianA).get(paths(studentId)[4]!)).status).toBe(404);

      expect(
        (await as(admin).post(`/periods/${school.period.id}/groups/${school.group5B.id}/close`))
          .status,
      ).toBe(200);
      expect((await as(guardianA).get(paths(studentId)[3]!)).body).toEqual([]);
      expect((await as(guardianA).get(paths(studentId)[4]!)).status).toBe(404);

      expect(
        (await as(admin).post(`/periods/${school.period.id}/groups/${school.group5B.id}/publish`))
          .status,
      ).toBe(200);
      const cards = (await as(guardianA).get(paths(studentId)[3]!)).body as ChildReportCard[];
      expect(cards).toHaveLength(1);
      expect(cards[0]!.fields).toHaveLength(4);
      expect(cards[0]!.fields.every((f) => typeof f.final === 'number')).toBe(true);
      expect(cards[0]!.publishedAt).not.toBeNull();
    });

    const withChromium = findChromium() ? it : it.skip;
    withChromium(
      'downloads the published report card of their own child only',
      async () => {
        const res = await binary(as(guardianA).get(paths(child(1).student.id)[4]!));
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toBe('application/pdf');
        expect((res.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
        expect((await as(guardianB).get(paths(child(1).student.id)[4]!)).status).toBe(404);
      },
      120_000,
    );

    it('after unlinking, the guardian gets 404 (admin or direction; never the teacher)', async () => {
      const links = await as(director).get(`/students/${child(2).student.id}/guardians`);
      expect(links.status).toBe(200);
      expect(links.body).toHaveLength(1);
      expect((await as(viry).delete(`/guardian-links/${links.body[0].id}`)).status).toBe(403);
      expect((await as(other).get(`/students/${child(2).student.id}/guardians`)).status).toBe(403);
      expect((await as(director).delete(`/guardian-links/${links.body[0].id}`)).status).toBe(204);
      expect((await as(guardianA).get(paths(child(2).student.id)[1]!)).status).toBe(404);
      expect(((await as(guardianA).get('/me/children')).body as ChildView[]).length).toBe(1);
    });
  });

  describe('director', () => {
    it('reads everything but cannot edit grades without a permission (403), and can with one (200)', async () => {
      // Reopen so the grades can change again.
      await as(admin)
        .post(`/periods/${school.period.id}/groups/${school.group5B.id}/reopen`, {
          reason: 'Prueba de permisos del director',
        })
        .expect(200);
      const activities = (
        await as(director).get(
          `/groups/${school.group5B.id}/activities?periodId=${school.period.id}`,
        )
      ).body as ActivityView[];
      expect(activities.length).toBeGreaterThan(0);
      const activity = activities[0]!;
      const body = { grades: [{ studentId: child(1).student.id, status: 'SCORED', score: 0.1 }] };
      expect((await as(director).put(`/activities/${activity.id}/grades`, body)).status).toBe(403);

      const grant = await as(admin).post('/permission-grants', {
        userId: school.director.id,
        action: 'grade:update',
        scope: { type: 'GROUP', groupId: school.group5B.id },
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        reason: 'Apoyo en captura',
      });
      expect(grant.status).toBe(201);
      expect((await as(director).put(`/activities/${activity.id}/grades`, body)).status).toBe(200);
      // The grant only covers 5°B.
      const abilities = await as(director).get('/auth/abilities');
      expect(abilities.status).toBe(200);
      expect(JSON.stringify(abilities.body.rules)).toContain(school.group5B.id);
      expect(JSON.stringify(abilities.body.rules)).not.toContain(school.group4A.id);
    });

    it('audit log: readable descriptions and filters by entity and user', async () => {
      const res = await as(director).get(`/audit?entity=grade&actorId=${school.director.id}`);
      expect(res.status).toBe(200);
      const items = (res.body as Paginated<AuditLogView>).items;
      expect(items).toHaveLength(1);
      expect(items[0]!.description).toMatch(/^Calificación de .+ en '.+': [\d.]+ → 0.1$/);
      expect(items[0]!.groupName).toBe('5°B');

      const links = (
        (await as(director).get('/audit?entity=guardianLink')).body as Paginated<AuditLogView>
      ).items;
      expect(links.some((l) => l.description.startsWith('Vinculó a Laura Familia'))).toBe(true);
      expect(links.some((l) => l.description.startsWith('Desvinculó a'))).toBe(true);
      const status = (
        (await as(director).get('/audit?entity=periodStatus')).body as Paginated<AuditLogView>
      ).items;
      expect(status[0]!.description).toContain('motivo: Prueba de permisos del director');
    });
  });

  describe('privacy notice', () => {
    it('is public, starts as a template pending review, and the admin edits it', async () => {
      const notice = await ctx.http().get('/api/v1/school/privacy-notice');
      expect(notice.status).toBe(200);
      expect(notice.body).toMatchObject({ version: 1, pendingReview: true });
      expect(notice.body.text).toContain('PENDIENTE DE REVISIÓN POR LA DIRECCIÓN');

      const text = 'Aviso de privacidad revisado por la dirección de la escuela. '.repeat(3);
      expect((await as(viry).put('/school/privacy-notice', { text })).status).toBe(403);
      const edited = await as(admin).put('/school/privacy-notice', { text });
      expect(edited.status).toBe(200);
      expect(edited.body).toMatchObject({ version: 2, pendingReview: false });

      // The direction also edits it now (school settings).
      expect((await as(director).put('/school/privacy-notice', { text })).status).toBe(200);
    });
  });
});
