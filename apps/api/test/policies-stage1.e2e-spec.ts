import type { ActivityView, GroupView, ImportPreview } from '@siseep/shared';
import { fixtureBuffer } from './fixture';
import { createTestContext, type TestContext } from './helpers';
import { type SchoolSetup, setupSchool } from './school-setup';

// Permission tests: never delete or skip (see CLAUDE.md).
describe('Authorization matrix, stage 1 (e2e)', () => {
  let ctx: TestContext;
  let school: SchoolSetup;
  let activities: ActivityView[];

  const as = (token: string) => ({
    get: (path: string) => ctx.http().get(`/api/v1${path}`).set('Authorization', `Bearer ${token}`),
    post: (path: string, body?: object) =>
      ctx.http().post(`/api/v1${path}`).set('Authorization', `Bearer ${token}`).send(body),
    patch: (path: string, body?: object) =>
      ctx.http().patch(`/api/v1${path}`).set('Authorization', `Bearer ${token}`).send(body),
    delete: (path: string) =>
      ctx.http().delete(`/api/v1${path}`).set('Authorization', `Bearer ${token}`),
  });

  beforeAll(async () => {
    ctx = await createTestContext();
    school = await setupSchool(ctx);
    // Load the 5°B Excel so there are activities of every field (and English).
    const preview = await ctx
      .http()
      .post('/api/v1/imports/excel/preview')
      .set('Authorization', `Bearer ${school.adminToken}`)
      .field('groupId', school.group5B.id)
      .field('periodId', school.period.id)
      .attach('file', fixtureBuffer(), 'excel.xlsx');
    await as(school.adminToken).post('/imports/excel/commit', {
      previewId: (preview.body as ImportPreview).previewId,
    });
    activities = (
      await as(school.adminToken).get(
        `/groups/${school.group5B.id}/activities?periodId=${school.period.id}`,
      )
    ).body as ActivityView[];
    expect(activities).toHaveLength(30);
  });

  afterAll(async () => {
    await ctx.close();
  });

  const saberes = () => activities.find((a) => a.fieldKey === 'saberes')!;
  const english = () => activities.find((a) => a.subjectKey === 'ingles')!;

  describe('TEACHER', () => {
    it('sees only their own groups', async () => {
      const res = await as(await ctx.token(school.viry)).get('/groups');
      expect(res.status).toBe(200);
      expect((res.body as GroupView[]).map((g) => g.name)).toEqual(['5°B']);
      expect((res.body as GroupView[])[0]).toMatchObject({
        studentCount: 20,
        schoolYearName: '2026-2027',
      });
    });

    it('a teacher of another group receives 403', async () => {
      const token = await ctx.token(school.otherTeacher);
      const group = school.group5B.id;
      expect((await as(token).get(`/groups/${group}`)).status).toBe(403);
      expect((await as(token).get(`/groups/${group}/roster`)).status).toBe(403);
      expect(
        (await as(token).get(`/groups/${group}/activities?periodId=${school.period.id}`)).status,
      ).toBe(403);
      expect((await as(token).patch(`/activities/${saberes().id}`, { name: 'X' })).status).toBe(
        403,
      );
    });

    it('the homeroom teacher reads the roster by N/L and edits her activities', async () => {
      const token = await ctx.token(school.viry);
      const roster = await as(token).get(`/groups/${school.group5B.id}/roster`);
      expect(roster.status).toBe(200);
      expect(roster.body.map((e: { listNumber: number }) => e.listNumber)).toEqual(
        Array.from({ length: 20 }, (_, i) => i + 1),
      );
      const res = await as(token).patch(`/activities/${saberes().id}`, { date: '2026-10-27' });
      expect(res.status).toBe(200);
    });

    it('the English teacher does not see Saberes', async () => {
      const token = await ctx.token(school.englishTeacher);
      const list = await as(token).get(
        `/groups/${school.group5B.id}/activities?periodId=${school.period.id}`,
      );
      expect(list.status).toBe(200);
      expect((list.body as ActivityView[]).map((a) => a.subjectKey)).toEqual(['ingles']);
      const onlySaberes = await as(token).get(
        `/groups/${school.group5B.id}/activities?periodId=${school.period.id}&fieldKey=saberes`,
      );
      expect(onlySaberes.body).toEqual([]);
      expect((await as(token).patch(`/activities/${saberes().id}`, { name: 'X' })).status).toBe(
        403,
      );
      expect(
        (await as(token).patch(`/activities/${english().id}`, { name: 'Inglés' })).status,
      ).toBe(200);
    });

    it('cannot use admin catalogs', async () => {
      const token = await ctx.token(school.viry);
      expect((await as(token).get('/students')).status).toBe(403);
      expect(
        (await as(token).post('/groups', { schoolYearId: school.year.id, grade: 6, letter: 'A' }))
          .status,
      ).toBe(403);
      expect((await as(token).get('/users')).status).toBe(403);
      expect((await as(token).get('/permission-grants')).status).toBe(403);
      expect((await as(token).patch(`/periods/${school.period.id}`, { name: 'X' })).status).toBe(
        403,
      );
    });
  });

  describe('DIRECTOR', () => {
    it('reads the whole school', async () => {
      const token = await ctx.token(school.director);
      expect(((await as(token).get('/groups')).body as GroupView[]).map((g) => g.name)).toEqual([
        '4°A',
        '5°B',
      ]);
      expect((await as(token).get('/students')).body.total).toBe(20);
      expect((await as(token).get(`/groups/${school.group5B.id}/roster`)).status).toBe(200);
    });

    it('without a grant receives 403 when editing; with an active grant 200; expired or revoked 403', async () => {
      const token = await ctx.token(school.director);
      const target = `/activities/${saberes().id}`;
      expect((await as(token).patch(target, { name: 'Tabla libreta CN' })).status).toBe(403);

      const grant = await as(school.adminToken).post('/permission-grants', {
        userId: school.director.id,
        action: 'activity:update',
        scope: { type: 'GROUP', groupId: school.group5B.id },
        expiresAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
        reason: 'Apoyo en captura',
      });
      expect(grant.status).toBe(201);
      expect(grant.body).toMatchObject({ active: true, scope: { groupName: '5°B' } });
      expect((await as(token).patch(target, { name: 'Tabla libreta CN' })).status).toBe(200);

      // Expire it (the API does not accept past dates, so move it in the database).
      await ctx.connection
        .collection('permissionGrants')
        .updateOne({}, { $set: { expiresAt: new Date(Date.now() - 1000) } });
      expect((await as(token).patch(target, { name: 'Tabla libreta CN' })).status).toBe(403);
      const listed = await as(school.adminToken).get('/permission-grants');
      expect(listed.body[0]).toMatchObject({ active: false });

      // A new grant, then revoked.
      const again = await as(school.adminToken).post('/permission-grants', {
        userId: school.director.id,
        action: 'activity:update',
        scope: { type: 'SCHOOL' },
      });
      expect((await as(token).patch(target, { name: 'Tabla libreta CN' })).status).toBe(200);
      expect(
        (await as(school.adminToken).delete(`/permission-grants/${again.body.id}`)).status,
      ).toBe(204);
      expect((await as(token).patch(target, { name: 'Tabla libreta CN' })).status).toBe(403);
    });

    it('cannot create catalogs', async () => {
      const token = await ctx.token(school.director);
      expect((await as(token).post('/students', { firstName: 'A', lastName1: 'B' })).status).toBe(
        403,
      );
      expect(
        (
          await as(token).post('/school-years', {
            name: '2027-2028',
            startDate: '2027-08-30',
            endDate: '2028-07-14',
          })
        ).status,
      ).toBe(403);
    });
  });

  describe('GUARDIAN', () => {
    it('has nothing in the school catalogs', async () => {
      const token = await ctx.token(school.guardian);
      expect((await as(token).get('/groups')).body).toEqual([]);
      expect((await as(token).get(`/groups/${school.group5B.id}`)).status).toBe(403);
      expect((await as(token).get('/students')).status).toBe(403);
      expect((await as(token).get('/school-years')).status).toBe(403);
      expect((await as(token).get('/periods')).status).toBe(403);
    });
  });
});
