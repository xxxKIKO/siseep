import type {
  CreatedAccountView,
  ImportPreview,
  PeriodResultsView,
  PeriodView,
  StudentHistory,
} from '@siseep/shared';
import ExcelJS from 'exceljs';
import type request from 'supertest';
import golden from '../../../packages/shared/test/fixtures/periodo1-5B.json';
import { fixtureBuffer } from './fixture';
import { activateGuardian, createGuardian } from './guardian-helpers';
import { createTestContext, type TestContext } from './helpers';
import { type SchoolSetup, setupSchool } from './school-setup';

const FIELDS = ['lenguajes', 'saberes', 'etica', 'humano'] as const;
const binary = (req: request.Test) =>
  req.buffer(true).parse((res, cb) => {
    const chunks: Buffer[] = [];
    res.on('data', (chunk: Buffer) => chunks.push(chunk));
    res.on('end', () => cb(null, Buffer.concat(chunks)));
  });

// Permission tests: never delete or skip (see CLAUDE.md).
describe('Student history and Excel export (e2e)', () => {
  let ctx: TestContext;
  let school: SchoolSetup;
  let admin: string;
  let viry: string;
  let director: string;
  let english: string;
  let other: string;
  let guardian: string;
  let rows: PeriodResultsView['rows'];
  let period2: PeriodView;

  const as = (token: string) => ({
    get: (path: string) => ctx.http().get(`/api/v1${path}`).set('Authorization', `Bearer ${token}`),
    post: (path: string, body?: object) =>
      ctx.http().post(`/api/v1${path}`).set('Authorization', `Bearer ${token}`).send(body),
  });
  const nl = (n: number) => rows.find((r) => r.student.listNumber === n)!;

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
    period2 = (
      await as(admin).post('/periods', {
        schoolYearId: school.year.id,
        number: 2,
        name: 'Periodo II',
        startDate: '2026-12-01',
        endDate: '2027-03-19',
      })
    ).body as PeriodView;
    viry = await ctx.token(school.viry);
    director = await ctx.token(school.director);
    english = await ctx.token(school.englishTeacher);
    other = await ctx.token(school.otherTeacher);
    rows = (
      (
        await as(viry).get(
          `/groups/${school.group5B.id}/period-results?periodId=${school.period.id}`,
        )
      ).body as PeriodResultsView
    ).rows;
    const created = await createGuardian(ctx, viry, nl(2).student.id, {
      phone: '3129990000',
      relationship: 'PADRE',
    });
    guardian = await activateGuardian(ctx, created.body as CreatedAccountView);
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('history while Periodo I is open: live finals (with adjustments) = Excel; Periodo II not started', async () => {
    const res = await as(viry).get(`/students/${nl(2).student.id}/history`);
    expect(res.status).toBe(200);
    const history = res.body as StudentHistory;
    expect(history.schoolYear.name).toBe('2026-2027');
    expect(history.fields.map((f) => f.key)).toEqual([...FIELDS]);
    expect(history.periods.map((p) => [p.name, p.source])).toEqual([
      ['Periodo I', 'live'],
      ['Periodo II', 'none'],
    ]);
    const expected = golden.students.find((s) => s.listNumber === 2)!.expected;
    for (const key of FIELDS) expect(history.periods[0]!.values[key]).toBe(expected[key].final);
    expect(history.periods[0]!.generalAverage).toBe(expected.generalAverage);
  });

  it('history access: homeroom, director, admin; not other teachers or the subject teacher', async () => {
    const path = `/students/${nl(2).student.id}/history`;
    expect((await as(director).get(path)).status).toBe(200);
    expect((await as(admin).get(path)).status).toBe(200);
    expect((await as(other).get(path)).status).toBe(403);
    expect((await as(english).get(path)).status).toBe(403);
    expect((await as(guardian).get(path)).status).toBe(403);
  });

  it('after closing and publishing: snapshot for staff; families see it only once published', async () => {
    const t = (action: string) =>
      `/periods/${school.period.id}/groups/${school.group5B.id}/${action}`;
    expect((await as(admin).post(t('close'))).status).toBe(200);
    const staff = (await as(viry).get(`/students/${nl(2).student.id}/history`))
      .body as StudentHistory;
    expect(staff.periods[0]!.source).toBe('snapshot');

    // Closed but not published: the family sees the average "en curso", not the report card.
    const before = (await as(guardian).get(`/me/children/${nl(2).student.id}/history`))
      .body as StudentHistory;
    expect(before.periods[0]!.source).toBe('live');
    expect(before.periods[0]!.generalAverage).toBeNull();

    expect((await as(admin).post(t('publish'))).status).toBe(200);
    const after = (await as(guardian).get(`/me/children/${nl(2).student.id}/history`))
      .body as StudentHistory;
    expect(after.periods[0]!.source).toBe('snapshot');
    expect(after.periods[0]!.values).toEqual(staff.periods[0]!.values);
    expect(after.periods[1]!.source).toBe('none');
    // Another child: 404.
    expect((await as(guardian).get(`/me/children/${nl(3).student.id}/history`)).status).toBe(404);
    expect(
      (
        await as(guardian).get(
          `/me/children/${nl(2).student.id}/history?schoolYearId=${period2.id}`,
        )
      ).status,
    ).toBe(404);
  });

  it('Excel concentrado: Resumen with the report-card grades of the Excel and one sheet per field', async () => {
    const path = `/groups/${school.group5B.id}/period-results.xlsx?periodId=${school.period.id}`;
    for (const token of [other, english, guardian])
      expect((await as(token).get(path)).status).toBe(403);
    expect((await binary(as(director).get(path))).status).toBe(200);
    const res = await binary(as(viry).get(path));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('spreadsheetml');
    expect(res.headers['content-disposition']).toContain(
      encodeURIComponent('Concentrado 5°B - Periodo I.xlsx'),
    );
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(res.body as never);
    expect(workbook.worksheets.map((w) => w.name)).toEqual([
      'Resumen',
      'Lenguajes',
      'Saberes',
      'Ética',
      'De lo humano',
    ]);
    const summary = workbook.getWorksheet('Resumen')!;
    const header = (summary.getRow(3).values as unknown[]).map(String);
    expect(header[1]).toBe('N/L');
    const boleta = (key: number) => 2 + key * 4 + 4; // 1-based: N/L, Alumno, then 4 per field
    for (const expected of golden.students) {
      const row = summary.getRow(3 + expected.listNumber);
      expect(row.getCell(1).value).toBe(expected.listNumber);
      FIELDS.forEach((key, i) => {
        expect(row.getCell(boleta(i)).value).toBe(expected.expected[key].final);
      });
      expect(row.getCell(2 + FIELDS.length * 4 + 1).value).toBe(expected.expected.generalAverage);
    }
    const saberes = workbook.getWorksheet('Saberes')!;
    expect(saberes.rowCount).toBe(22); // title + header + 20 students
  });
});
