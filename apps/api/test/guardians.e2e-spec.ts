import type {
  ActivityView,
  AuditLogView,
  ChildActivity,
  ChildNote,
  ChildOverview,
  ChildReportCard,
  ChildView,
  GroupGuardianRow,
  GuardianInvitationView,
  ImportPreview,
  Paginated,
  PeriodResultsView,
} from '@siseep/shared';
import type request from 'supertest';
import { Invitation } from '../src/invitations/invitation.schema';
import { findChromium } from '../src/reports/pdf.service';
import { fixtureBuffer } from './fixture';
import { createTestContext, type TestContext } from './helpers';
import { type SchoolSetup, setupSchool } from './school-setup';

const binary = (req: request.Test) =>
  req.buffer(true).parse((res, cb) => {
    const chunks: Buffer[] = [];
    res.on('data', (chunk: Buffer) => chunks.push(chunk));
    res.on('end', () => cb(null, Buffer.concat(chunks)));
  });

// Permission tests: never delete or skip (see CLAUDE.md).
describe('Guardian codes, guardian portal and director (e2e)', () => {
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
  const publicPost = (path: string, body: object) => ctx.http().post(`/api/v1${path}`).send(body);
  const newCode = async (studentId: string, token = viry) => {
    const res = await as(token).post('/invitations/guardian', { studentId });
    expect(res.status).toBe(201);
    return res.body as GuardianInvitationView;
  };
  let emailCounter = 0;
  const register = (code: string, extra: object = {}) => {
    emailCounter += 1;
    return publicPost('/auth/register-guardian', {
      code,
      firstName: 'Laura',
      lastName: `Familia ${emailCounter}`,
      email: `familia${emailCounter}@correo.mx`,
      password: 'contraseña-de-familia',
      relationship: 'MADRE',
      acceptPrivacy: true,
      ...extra,
    });
  };

  // Two families: A (two children: N/L 1 and N/L 2) and B (N/L 3).
  let guardianA: string;
  let guardianB: string;
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

  describe('guardian codes', () => {
    it('the homeroom teacher and the admin generate codes; nobody else', async () => {
      const code = await newCode(child(1).student.id);
      expect(code.code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/);
      expect(code.url).toBe(`http://localhost:5173/registro?codigo=${code.code}`);
      const days = (new Date(code.expiresAt).getTime() - Date.now()) / 86_400_000;
      expect(days).toBeGreaterThan(13.9);
      expect(days).toBeLessThanOrEqual(14);
      await newCode(child(1).student.id, admin);

      for (const token of [other, english, director]) {
        const res = await as(token).post('/invitations/guardian', {
          studentId: child(1).student.id,
        });
        expect(res.status).toBe(403);
      }
      // The teacher of 4°A cannot even see the 5°B list; staff invitations stay admin-only.
      expect(
        (await as(other).get(`/groups/${school.group5B.id}/guardian-invitations`)).status,
      ).toBe(403);
      expect(
        (await as(viry).post('/invitations/staff', { email: 'x@correo.mx', roles: ['TEACHER'] }))
          .status,
      ).toBe(403);
      expect((await as(viry).get('/invitations')).status).toBe(403);
    });

    it('stores only the hash of the code', async () => {
      const code = await newCode(child(2).student.id);
      const stored = await ctx.connection
        .model(Invitation.name)
        .findById(code.id)
        .lean<{ codeHash: string }>()
        .exec();
      expect(stored!.codeHash).toMatch(/^[a-f\d]{64}$/);
      expect(JSON.stringify(stored)).not.toContain(code.code);
    });

    it('preview shows the partially hidden name and the group', async () => {
      const code = await newCode(child(3).student.id);
      const res = await publicPost('/auth/guardian-code', { code: code.code.toLowerCase() });
      expect(res.status).toBe(200);
      expect(res.body.groupName).toBe('5°B');
      expect(res.body.studentName).not.toBe(child(3).student.fullName);
      expect(res.body.studentName).toMatch(/\b[A-ZÁÉÍÓÚÑ]\./);
    });
  });

  describe('guardian sign-up', () => {
    it('registers family A with a code; the code cannot be used again', async () => {
      const code = await newCode(child(1).student.id);
      const res = await register(code.code);
      expect(res.status).toBe(200);
      expect(res.body.user.roles).toEqual(['GUARDIAN']);
      expect(res.body.user.privacyAcceptedVersion).toBe(1);
      guardianA = res.body.accessToken as string;

      const again = await register(code.code);
      expect(again.status).toBe(400);
    });

    it('rejects an expired code', async () => {
      const code = await newCode(child(4).student.id);
      await ctx.connection
        .model(Invitation.name)
        .updateOne({ _id: code.id }, { $set: { expiresAt: new Date(Date.now() - 1000) } })
        .exec();
      expect((await register(code.code)).status).toBe(400);
    });

    it('requires accepting the privacy notice', async () => {
      const code = await newCode(child(4).student.id);
      expect((await register(code.code, { acceptPrivacy: false })).status).toBe(400);
    });

    it('family A adds a second child with another code ("Agregar hijo")', async () => {
      const code = await newCode(child(2).student.id);
      const res = await as(guardianA).post('/me/children', {
        code: code.code,
        relationship: 'MADRE',
      });
      expect(res.status).toBe(201);
      expect((res.body as ChildView[]).map((c) => c.id).sort()).toEqual(
        [child(1).student.id, child(2).student.id].sort(),
      );
    });

    it('family B registers for N/L 3', async () => {
      const code = await newCode(child(3).student.id);
      const res = await register(code.code, { relationship: 'PADRE' });
      expect(res.status).toBe(200);
      guardianB = res.body.accessToken as string;
    });

    it('a student has at most 4 guardians', async () => {
      const target = child(5).student.id;
      for (let i = 0; i < 4; i++) {
        const code = await newCode(target);
        const res = await as(guardianB).post('/me/children', {
          code: code.code,
          relationship: 'TUTOR',
        });
        if (i === 0) expect(res.status).toBe(201);
        else expect(res.status).toBe(409); // same guardian twice
      }
      // Three more families for N/L 5 → 4 in total, then the 5th is rejected.
      for (let i = 0; i < 3; i++) {
        const code = await newCode(target);
        expect((await register(code.code)).status).toBe(200);
      }
      expect((await as(viry).post('/invitations/guardian', { studentId: target })).status).toBe(
        409,
      );
    });

    it('the teacher sees the status per student (never the codes)', async () => {
      const res = await as(viry).get(`/groups/${school.group5B.id}/guardian-invitations`);
      expect(res.status).toBe(200);
      const rows = res.body as GroupGuardianRow[];
      expect(rows).toHaveLength(20);
      expect(rows.find((r) => r.student.id === child(1).student.id)!.status).toBe('LINKED');
      expect(rows.find((r) => r.student.id === child(4).student.id)!.status).toBe('PENDING');
      expect(rows.find((r) => r.student.id === child(6).student.id)!.status).toBe('NONE');
      expect(rows.find((r) => r.student.id === child(5).student.id)!.links).toHaveLength(4);
      expect(JSON.stringify(rows)).not.toMatch(/"code"/);
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

    it('after unlinking, the guardian gets 404 (admin only)', async () => {
      const links = await as(admin).get(`/students/${child(2).student.id}/guardians`);
      expect(links.status).toBe(200);
      expect(links.body).toHaveLength(1);
      expect((await as(viry).delete(`/guardian-links/${links.body[0].id}`)).status).toBe(403);
      expect((await as(director).get(`/students/${child(2).student.id}/guardians`)).status).toBe(
        403,
      );
      expect((await as(admin).delete(`/guardian-links/${links.body[0].id}`)).status).toBe(204);
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
      expect(links.some((l) => l.description.startsWith('Vinculó a Laura'))).toBe(true);
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

      // A new version must be accepted again before adding another child.
      const code = await newCode(child(7).student.id);
      expect(
        (await as(guardianB).post('/me/children', { code: code.code, relationship: 'PADRE' }))
          .status,
      ).toBe(400);
      expect(
        (
          await as(guardianB).post('/me/children', {
            code: code.code,
            relationship: 'PADRE',
            acceptPrivacy: true,
          })
        ).status,
      ).toBe(201);
    });
  });

  it('printable strips: a PDF with new codes for the students without guardians', async () => {
    if (!findChromium()) return;
    const res = await binary(
      as(viry).post(`/groups/${school.group5B.id}/guardian-codes.pdf`).send({}),
    );
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(Number(res.headers['x-codes-count'])).toBeGreaterThan(10);
  }, 120_000);
});
