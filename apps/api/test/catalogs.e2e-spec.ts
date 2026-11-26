import { DEFAULT_GRADING_SCHEME, type GroupView, type StudentView } from '@siseep/shared';
import { createTestContext, type TestContext } from './helpers';
import { type SchoolSetup, setupSchool } from './school-setup';

// 1x1 PNG
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

describe('Catalogs (e2e)', () => {
  let ctx: TestContext;
  let school: SchoolSetup;

  const admin = () => ({
    get: (path: string) =>
      ctx.http().get(`/api/v1${path}`).set('Authorization', `Bearer ${school.adminToken}`),
    post: (path: string, body?: object) =>
      ctx
        .http()
        .post(`/api/v1${path}`)
        .set('Authorization', `Bearer ${school.adminToken}`)
        .send(body),
    patch: (path: string, body?: object) =>
      ctx
        .http()
        .patch(`/api/v1${path}`)
        .set('Authorization', `Bearer ${school.adminToken}`)
        .send(body),
    put: (path: string, body?: object) =>
      ctx
        .http()
        .put(`/api/v1${path}`)
        .set('Authorization', `Bearer ${school.adminToken}`)
        .send(body),
  });

  beforeAll(async () => {
    ctx = await createTestContext();
    school = await setupSchool(ctx);
  });

  afterAll(async () => {
    await ctx.close();
  });

  describe('school', () => {
    it('edits the data and stores the logo in GridFS', async () => {
      const res = await admin().patch('/school', {
        name: 'Esc. Prim. Fed. Dr. Salvador Allende T.M.',
        cct: '06dpr0001x',
        city: 'Colima',
      });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ cct: '06DPR0001X', hasLogo: false });

      const upload = await ctx
        .http()
        .put('/api/v1/school/logo')
        .set('Authorization', `Bearer ${school.adminToken}`)
        .attach('file', PNG, 'logo.png');
      expect(upload.status).toBe(200);
      expect(upload.body.hasLogo).toBe(true);

      const logo = await ctx
        .http()
        .get('/api/v1/school/logo')
        .set('Authorization', `Bearer ${await ctx.token(school.viry)}`);
      expect(logo.status).toBe(200);
      expect(logo.headers['content-type']).toBe('image/png');
      expect(Buffer.compare(logo.body as Buffer, PNG)).toBe(0);
    });

    it('rejects logos that are not PNG/JPG or weigh more than 1 MB', async () => {
      const fake = await ctx
        .http()
        .put('/api/v1/school/logo')
        .set('Authorization', `Bearer ${school.adminToken}`)
        .attach('file', Buffer.from('GIF89a....'), 'logo.png');
      expect(fake.status).toBe(400);
      expect(fake.body.code).toBe('INVALID_FILE');
      const big = await ctx
        .http()
        .put('/api/v1/school/logo')
        .set('Authorization', `Bearer ${school.adminToken}`)
        .attach('file', Buffer.concat([PNG, Buffer.alloc(1024 * 1024)]), 'logo.png');
      expect(big.status).toBe(413);
      expect(big.body.code).toBe('INVALID_FILE');
    });
  });

  describe('school years, periods and grading scheme', () => {
    it('creates the year with the default grading scheme of section 5', async () => {
      const res = await admin().get(`/school-years/${school.year.id}/grading-scheme`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual(DEFAULT_GRADING_SCHEME);
    });

    it('validates that weights add up to 100%', async () => {
      const bad = structuredClone(DEFAULT_GRADING_SCHEME);
      bad.fields[0]!.weights.EXAMEN = 0.5;
      const res = await admin().put(`/school-years/${school.year.id}/grading-scheme`, bad);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');

      const good = structuredClone(DEFAULT_GRADING_SCHEME);
      good.lowThreshold = 6;
      expect(
        (await admin().put(`/school-years/${school.year.id}/grading-scheme`, good)).body
          .lowThreshold,
      ).toBe(6);
    });

    it('keeps only one current year and unique period numbers', async () => {
      const next = await admin().post('/school-years', {
        name: '2027-2028',
        startDate: '2027-08-30',
        endDate: '2028-07-14',
        isCurrent: true,
      });
      expect(next.status).toBe(201);
      const years = (await admin().get('/school-years')).body as {
        name: string;
        isCurrent: boolean;
      }[];
      expect(years.filter((y) => y.isCurrent).map((y) => y.name)).toEqual(['2027-2028']);

      const dup = await admin().post('/periods', {
        schoolYearId: school.year.id,
        number: 1,
        name: 'X',
        startDate: '2026-09-01',
        endDate: '2026-10-01',
      });
      expect(dup.status).toBe(409);
      const backwards = await admin().post('/periods', {
        schoolYearId: school.year.id,
        number: 2,
        name: 'Periodo II',
        startDate: '2026-12-01',
        endDate: '2026-11-01',
      });
      expect(backwards.status).toBe(400);
      const edited = await admin().patch(`/periods/${school.period.id}`, {
        deliveryDate: '2026-11-18',
      });
      expect(edited.body).toMatchObject({ deliveryDate: '2026-11-18', status: 'OPEN' });
    });
  });

  describe('groups, students and enrollments', () => {
    it('creates groups with their homeroom teacher and rejects duplicates', async () => {
      const group = (await admin().get(`/groups/${school.group5B.id}`)).body as GroupView;
      expect(group).toMatchObject({ name: '5°B', homeroomTeacher: { id: school.viry.id } });
      expect(group.assignments.map((a) => a.scope).sort()).toEqual(['HOMEROOM', 'SUBJECT']);
      expect(group.currentPeriod?.name).toBe('Periodo I');
      const dup = await admin().post('/groups', {
        schoolYearId: school.year.id,
        grade: 5,
        letter: 'B',
      });
      expect(dup.status).toBe(409);
      const notTeacher = await admin().post(`/groups/${school.group5B.id}/assignments`, {
        teacherId: school.director.id,
        scope: 'HOMEROOM',
      });
      expect(notTeacher.status).toBe(400);
    });

    it('enrolls students with a unique N/L per group', async () => {
      const ana = (
        await admin().post('/students', { firstName: 'Ana', lastName1: 'Núñez', lastName2: 'Ríos' })
      ).body as StudentView;
      const beto = (await admin().post('/students', { firstName: 'Beto', lastName1: 'Ortiz' }))
        .body as StudentView;
      expect(ana.fullName).toBe('Núñez Ríos Ana');

      const enrolled = await admin().post('/enrollments', {
        studentId: ana.id,
        groupId: school.group4A.id,
        listNumber: 1,
      });
      expect(enrolled.status).toBe(201);
      expect(enrolled.body.enrollment).toMatchObject({ groupName: '4°A', listNumber: 1 });

      const taken = await admin().post('/enrollments', {
        studentId: beto.id,
        groupId: school.group4A.id,
        listNumber: 1,
      });
      expect(taken.status).toBe(409);
      const twice = await admin().post('/enrollments', {
        studentId: ana.id,
        groupId: school.group5B.id,
        listNumber: 2,
      });
      expect(twice.status).toBe(409);

      // Accent-free search.
      const found = await admin().get('/students?q=nunez');
      expect(found.body.items.map((s: StudentView) => s.id)).toEqual([ana.id]);

      // Withdrawal frees the N/L.
      await admin().patch(`/enrollments/${enrolled.body.enrollment.id}`, { status: 'WITHDRAWN' });
      expect(
        (
          await admin().post('/enrollments', {
            studentId: beto.id,
            groupId: school.group4A.id,
            listNumber: 1,
          })
        ).status,
      ).toBe(201);
    });
  });

  describe('users (admin)', () => {
    it('lists, changes roles, disables and forces a password reset', async () => {
      const list = await admin().get('/users?role=TEACHER');
      expect(list.status).toBe(200);
      expect(list.body.total).toBe(3);

      const viry = school.viry.id;
      const roles = await admin().patch(`/users/${viry}`, { roles: ['TEACHER', 'DIRECTOR'] });
      expect(roles.body.roles).toEqual(['TEACHER', 'DIRECTOR']);

      const reset = await admin().post(`/users/${viry}/reset-password`);
      expect(reset.status).toBe(204);
      expect(ctx.mail.lastTo(school.viry.email)?.text).toContain(
        'La administración de la escuela pidió',
      );

      const disabled = await admin().post(`/users/${school.otherTeacher.id}/disable`);
      expect(disabled.body.status).toBe('DISABLED');
      const login = await ctx
        .http()
        .post('/api/v1/auth/login')
        .send({ email: school.otherTeacher.email, password: school.otherTeacher.password });
      expect(login.status).toBe(403);
      expect(login.body.code).toBe('ACCOUNT_DISABLED');
      expect((await admin().post(`/users/${school.otherTeacher.id}/enable`)).body.status).toBe(
        'ACTIVE',
      );
    });

    it('protects the last admin', async () => {
      const self = await admin().post(`/users/${school.admin.id}/disable`);
      expect(self.status).toBe(400);
      const demote = await admin().patch(`/users/${school.admin.id}`, { roles: ['TEACHER'] });
      expect(demote.status).toBe(400);
    });
  });
});
