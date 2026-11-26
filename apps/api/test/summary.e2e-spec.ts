import type {
  ActivityView,
  GroupOverview,
  GroupSummary,
  ImportPreview,
  StudentSummaryView,
} from '@siseep/shared';
import golden from '../../../packages/shared/test/fixtures/periodo1-5B.json';
import { fixtureBuffer } from './fixture';
import { createTestContext, type TestContext } from './helpers';
import { type SchoolSetup, setupSchool } from './school-setup';

// Permission tests included: never delete or skip (see CLAUDE.md).
describe('Live summary (e2e)', () => {
  let ctx: TestContext;
  let school: SchoolSetup;
  let viry: string;
  let director: string;
  const as = (token: string) => ({
    get: (path: string) => ctx.http().get(`/api/v1${path}`).set('Authorization', `Bearer ${token}`),
    post: (path: string, body?: object) =>
      ctx.http().post(`/api/v1${path}`).set('Authorization', `Bearer ${token}`).send(body),
    put: (path: string, body?: object) =>
      ctx.http().put(`/api/v1${path}`).set('Authorization', `Bearer ${token}`).send(body),
  });
  const summaryOf = async (token: string) =>
    (await as(token).get(`/groups/${school.group5B.id}/summary?periodId=${school.period.id}`))
      .body as GroupSummary;

  beforeAll(async () => {
    ctx = await createTestContext();
    school = await setupSchool(ctx);
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
    viry = await ctx.token(school.viry);
    director = await ctx.token(school.director);
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('imported Excel → summary: the 80 grades and 20 averages match the Excel', async () => {
    const res = await as(viry).get(
      `/groups/${school.group5B.id}/summary?periodId=${school.period.id}`,
    );
    expect(res.status).toBe(200);
    const summary = res.body as GroupSummary;
    expect(summary.students).toHaveLength(20);
    expect(summary.capture).toEqual({ activities: 30, expected: 600, captured: 600, percent: 100 });

    for (const expected of golden.students) {
      const row = summary.students.find((s) => s.student.listNumber === expected.listNumber)!;
      for (const key of ['lenguajes', 'saberes', 'etica', 'humano'] as const) {
        const field = row.result.fields.find((f) => f.fieldKey === key)!;
        expect(field.calculated).toBeCloseTo(expected.expected[key].calculated, 4);
        expect(field.rounded).toBe(expected.expected[key].rounded);
        expect(field.final).toBe(expected.expected[key].final);
      }
      expect(row.result.generalAverage).toBe(expected.expected.generalAverage);
      expect(row.result.lowFields).toEqual(expected.expected.lowFields);
    }
  });

  it('builds group stats and alerts', async () => {
    const summary = await summaryOf(viry);
    expect(summary.fields.map((f) => f.shortName)).toEqual([
      'Lenguajes',
      'Saberes',
      'Ética',
      'De lo humano',
    ]);
    const saberes = summary.stats.byField.find((f) => f.fieldKey === 'saberes')!;
    expect(Object.values(saberes.distribution).reduce((a, b) => a + b, 0)).toBe(20);
    // N/L 2 (Álvarez): Saberes ≈ 5.93 → LOW_6; Ética 4.425 → LOW_6.
    const alvarez = summary.students.find((s) => s.student.listNumber === 2)!.student.id;
    expect(summary.alerts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ studentId: alvarez, fieldKey: 'saberes', type: 'LOW_6' }),
        expect.objectContaining({ studentId: alvarez, fieldKey: 'etica', type: 'LOW_6' }),
      ]),
    );
    expect(summary.alerts.some((a) => a.type === 'PENDING' || a.type === 'PARTIAL')).toBe(false);
    expect(summary.stats.studentsWithAlerts).toBeGreaterThan(0);
  });

  it('a new activity without grades makes everyone PENDING and lists it', async () => {
    const activity = (
      await as(viry).post('/activities', {
        groupId: school.group5B.id,
        periodId: school.period.id,
        fieldKey: 'etica',
        component: 'EXAMEN',
        name: 'Examen 2',
        date: '2026-11-20',
      })
    ).body as ActivityView;
    const summary = await summaryOf(viry);
    expect(summary.pendingActivities).toEqual([
      expect.objectContaining({ activityId: activity.id, pending: 20 }),
    ]);
    expect(summary.alerts.filter((a) => a.type === 'PENDING')).toHaveLength(20);
    expect(summary.capture).toMatchObject({ activities: 31, captured: 600, expected: 620 });
  });

  it('caches 30 s and invalidates when grades are saved', async () => {
    const first = await summaryOf(viry);
    const again = await summaryOf(viry);
    expect(again.generatedAt).toBe(first.generatedAt); // served from cache

    const target = first.students.find((s) => s.student.listNumber === 1)!;
    const examen = first.pendingActivities[0]!;
    const saved = await as(viry).put(`/activities/${examen.activityId}/grades`, {
      grades: [{ studentId: target.student.id, status: 'SCORED', score: 4 }],
    });
    expect(saved.status).toBe(200);

    const after = await summaryOf(viry);
    expect(after.generatedAt).not.toBe(first.generatedAt);
    const etica = after.students
      .find((s) => s.student.id === target.student.id)!
      .result.fields.find((f) => f.fieldKey === 'etica')!;
    // Exam average is now (examen1 + 4) / 2: the field changed.
    expect(etica.calculated).not.toBeCloseTo(
      first.students
        .find((s) => s.student.id === target.student.id)!
        .result.fields.find((f) => f.fieldKey === 'etica')!.calculated!,
      6,
    );
    expect(after.pendingActivities[0]!.pending).toBe(19);
  });

  it('respects the scope: other group 403, English teacher 403, director 200', async () => {
    const path = `/groups/${school.group5B.id}/summary?periodId=${school.period.id}`;
    expect((await as(await ctx.token(school.otherTeacher)).get(path)).status).toBe(403);
    expect((await as(await ctx.token(school.englishTeacher)).get(path)).status).toBe(403);
    expect((await as(await ctx.token(school.guardian)).get(path)).status).toBe(403);
    expect((await as(director).get(path)).status).toBe(200);
  });

  it('student summary: same result plus activity detail; scoped', async () => {
    const summary = await summaryOf(viry);
    const aguilar = summary.students.find((s) => s.student.listNumber === 1)!;
    const res = await as(viry).get(
      `/students/${aguilar.student.id}/summary?periodId=${school.period.id}`,
    );
    expect(res.status).toBe(200);
    const view = res.body as StudentSummaryView;
    expect(view.result).toEqual(aguilar.result);
    expect(view.activities.flatMap((a) => a.items)).toHaveLength(31);
    expect(
      view.activities
        .find((a) => a.fieldKey === 'lenguajes')!
        .items.find((i) => i.subjectKey === 'ingles'),
    ).toMatchObject({ grade: expect.objectContaining({ score: 10 }) });
    expect(
      (
        await as(await ctx.token(school.otherTeacher)).get(
          `/students/${aguilar.student.id}/summary?periodId=${school.period.id}`,
        )
      ).status,
    ).toBe(403);
  });

  it('dashboard: the director sees every group with capture progress and alerts', async () => {
    const res = await as(director).get('/dashboard/groups');
    expect(res.status).toBe(200);
    const rows = res.body as GroupOverview[];
    expect(rows.map((r) => r.group.name)).toEqual(['4°A', '5°B']);
    const quintoB = rows.find((r) => r.group.name === '5°B')!;
    expect(quintoB).toMatchObject({ studentCount: 20, period: { name: 'Periodo I' } });
    expect(quintoB.capture?.activities).toBe(31);
    expect(quintoB.byField).toHaveLength(4);
    expect(quintoB.studentsWithAlerts).toBeGreaterThan(0);
    expect(rows.find((r) => r.group.name === '4°A')!.capture).toMatchObject({
      activities: 0,
      percent: 0,
    });

    const forViry = (await as(viry).get('/dashboard/groups')).body as GroupOverview[];
    expect(forViry.map((r) => r.group.name)).toEqual(['5°B']);
  });

  it('20 students × 60 activities answers in under 300 ms (uncached)', async () => {
    const summary = await summaryOf(viry);
    const ids = summary.students.map((s) => s.student.id);
    for (let i = 0; i < 29; i++) {
      const activity = (
        await as(viry).post('/activities', {
          groupId: school.group5B.id,
          periodId: school.period.id,
          fieldKey: (['lenguajes', 'saberes', 'etica', 'humano'] as const)[i % 4],
          component: 'PROYECTO',
          name: `Carga ${i}`,
          date: '2026-11-21',
        })
      ).body as ActivityView;
      await as(viry).put(`/activities/${activity.id}/grades`, {
        grades: ids.map((studentId, n) => ({ studentId, status: 'SCORED', score: (n % 10) + 1 })),
      });
    }
    const timings: number[] = [];
    for (let run = 0; run < 3; run++) {
      // Saving a grade invalidates the cache, so each run calculates again.
      await as(viry).put(`/activities/${summary.pendingActivities[0]!.activityId}/grades`, {
        grades: [{ studentId: ids[run + 1]!, status: 'SCORED', score: 8 }],
      });
      const start = performance.now();
      const res = await as(viry).get(
        `/groups/${school.group5B.id}/summary?periodId=${school.period.id}`,
      );
      timings.push(performance.now() - start);
      expect((res.body as GroupSummary).capture.activities).toBe(60);
    }
    expect(Math.min(...timings)).toBeLessThan(300);
  }, 120_000);
});
