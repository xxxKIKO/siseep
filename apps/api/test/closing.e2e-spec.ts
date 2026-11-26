import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  ActivityView,
  ClosingIssue,
  ImportPreview,
  PeriodGroupStatusView,
  PeriodResultRow,
  PeriodResultsView,
} from '@siseep/shared';
import mammoth from 'mammoth';
import { PDFDocument } from 'pdf-lib';
import puppeteer from 'puppeteer-core';
import type request from 'supertest';
import golden from '../../../packages/shared/test/fixtures/periodo1-5B.json';
import { findChromium } from '../src/reports/pdf.service';
import { fixtureBuffer } from './fixture';
import { createTestContext, type TestContext } from './helpers';
import { type SchoolSetup, setupSchool } from './school-setup';

const FIELDS = ['lenguajes', 'saberes', 'etica', 'humano'] as const;
/** 1×1 transparent PNG (logo upload without Chromium). */
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

const binary = (req: request.Test) =>
  req.buffer(true).parse((res, cb) => {
    const chunks: Buffer[] = [];
    res.on('data', (chunk: Buffer) => chunks.push(chunk));
    res.on('end', () => cb(null, Buffer.concat(chunks)));
  });

// Permission tests: never delete or skip (see CLAUDE.md).
describe('Period closing and report cards (e2e)', () => {
  let ctx: TestContext;
  let school: SchoolSetup;
  let viry: string;
  let director: string;
  let english: string;
  let other: string;
  let guardian: string;
  let admin: string;

  const as = (token: string) => {
    const auth = (req: request.Test) => req.set('Authorization', `Bearer ${token}`);
    return {
      get: (path: string) => auth(ctx.http().get(`/api/v1${path}`)),
      post: (path: string, body?: object) => auth(ctx.http().post(`/api/v1${path}`)).send(body),
      put: (path: string, body?: object) => auth(ctx.http().put(`/api/v1${path}`)).send(body),
      patch: (path: string, body?: object) => auth(ctx.http().patch(`/api/v1${path}`)).send(body),
      delete: (path: string) => auth(ctx.http().delete(`/api/v1${path}`)),
    };
  };
  const resultsPath = () =>
    `/groups/${school.group5B.id}/period-results?periodId=${school.period.id}`;
  const results = async (token = viry) =>
    (await as(token).get(resultsPath())).body as PeriodResultsView;
  const transition = (token: string, action: string, body?: object) =>
    as(token).post(`/periods/${school.period.id}/groups/${school.group5B.id}/${action}`, body);
  const byList = (view: PeriodResultsView, listNumber: number) =>
    view.rows.find((r) => r.student.listNumber === listNumber)!;

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
    const commit = await as(admin).post('/imports/excel/commit', {
      previewId: (preview.body as ImportPreview).previewId,
    });
    expect(commit.status).toBe(200);
    viry = await ctx.token(school.viry);
    director = await ctx.token(school.director);
    english = await ctx.token(school.englishTeacher);
    other = await ctx.token(school.otherTeacher);
    guardian = await ctx.token(school.guardian);
  });

  afterAll(async () => {
    await ctx.close();
  });

  describe('results while OPEN', () => {
    it('live calculation merged with the imported adjustments equals the Excel', async () => {
      const view = await results();
      expect(view.status).toBe('OPEN');
      expect(view.rows).toHaveLength(20);
      expect(view.issues).toEqual([]);
      expect(view.can).toEqual({
        edit: true,
        review: true,
        close: false,
        publish: false,
        reopen: false,
      });
      for (const expected of golden.students) {
        const row = byList(view, expected.listNumber);
        expect(row.source).toBe('live');
        expect(row.id).toMatch(/^[a-f\d]{24}$/);
        for (const key of FIELDS) {
          expect(row.fields.find((f) => f.fieldKey === key)!.final).toBe(
            expected.expected[key].final,
          );
        }
        expect(row.generalAverage).toBe(expected.expected.generalAverage);
      }
      expect(view.progress.total).toBe(20);
    });

    it('who can read the results: homeroom, director, admin — not subject teachers, others or guardians', async () => {
      expect((await as(director).get(resultsPath())).status).toBe(200);
      expect((await results(director)).can.edit).toBe(false);
      expect((await as(admin).get(resultsPath())).status).toBe(200);
      expect((await as(english).get(resultsPath())).status).toBe(403);
      expect((await as(other).get(resultsPath())).status).toBe(403);
      expect((await as(guardian).get(resultsPath())).status).toBe(403);
    });

    it('rejects an adjustment of 11 (and 4, and 7.5); accepts 9 with a reason and audits it', async () => {
      const row = byList(await results(), 1);
      for (const override of [11, 4, 7.5]) {
        const res = await as(viry).patch(`/period-results/${row.id}`, {
          fields: [{ fieldKey: 'lenguajes', override }],
        });
        expect(res.status).toBe(400);
      }
      const original = row.fields.find((f) => f.fieldKey === 'lenguajes')!.override;
      const ok = await as(viry).patch(`/period-results/${row.id}`, {
        fields: [
          { fieldKey: 'lenguajes', override: 9, overrideReason: 'Mejoró en la última semana' },
        ],
      });
      expect(ok.status).toBe(200);
      const updated = ok.body as PeriodResultRow;
      const lenguajes = updated.fields.find((f) => f.fieldKey === 'lenguajes')!;
      expect(lenguajes).toMatchObject({ override: 9, final: 9, adjusted: true });
      expect(lenguajes.overrideReason).toBe('Mejoró en la última semana');

      const audit = await as(admin).get(`/audit?entity=periodResult&entityId=${row.id}`);
      expect(audit.status).toBe(200);
      expect(audit.body.items[0]).toMatchObject({ action: 'update', entity: 'periodResult' });

      // Back to the Excel value so the closing snapshot still matches the golden data.
      await as(viry).patch(`/period-results/${row.id}`, {
        fields: [{ fieldKey: 'lenguajes', override: original }],
      });
    });

    it('observations and legend: saved, counted in the progress, never by others', async () => {
      const before = await results();
      const target = before.rows.find(
        (r) => !r.observations.general && Object.keys(r.observations.byField).length === 0,
      );
      const row = target ?? byList(before, 3);
      const res = await as(viry).patch(`/period-results/${row.id}`, {
        observations: {
          general: 'Participa con entusiasmo.',
          byField: { lenguajes: 'Lee con fluidez.', saberes: 'Repasar fracciones.' },
        },
        legendOverride: 'Ojo en: Saberes (fracciones).',
      });
      expect(res.status).toBe(200);
      expect((res.body as PeriodResultRow).observations).toEqual({
        general: 'Participa con entusiasmo.',
        byField: { lenguajes: 'Lee con fluidez.', saberes: 'Repasar fracciones.' },
      });
      const after = await results();
      if (target)
        expect(after.progress.withObservations).toBe(before.progress.withObservations + 1);

      expect(
        (await as(other).patch(`/period-results/${row.id}`, { legendOverride: 'x' })).status,
      ).toBe(403);
      expect(
        (await as(english).patch(`/period-results/${row.id}`, { legendOverride: 'x' })).status,
      ).toBe(403);
      expect(
        (await as(director).patch(`/period-results/${row.id}`, { legendOverride: 'x' })).status,
      ).toBe(403);
    });
  });

  describe('closing with pending grades', () => {
    it('responds 422 with {studentId, fieldKey, activityIds} and changes nothing', async () => {
      const activity = (
        await as(viry).post('/activities', {
          groupId: school.group5B.id,
          periodId: school.period.id,
          fieldKey: 'etica',
          component: 'EXAMEN',
          name: 'Examen extra',
          date: '2026-11-20',
        })
      ).body as ActivityView;
      expect((await results()).issues).toHaveLength(20);

      const res = await transition(admin, 'close');
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('PERIOD_INCOMPLETE');
      const details = res.body.details as ClosingIssue[];
      expect(details).toHaveLength(20);
      expect(details[0]).toMatchObject({ fieldKey: 'etica', activityIds: [activity.id] });
      expect(details[0]!.studentId).toMatch(/^[a-f\d]{24}$/);
      expect((await results()).status).toBe('OPEN');

      expect((await as(viry).delete(`/activities/${activity.id}`)).status).toBe(204);
      expect((await results()).issues).toEqual([]);
    });
  });

  describe('transitions', () => {
    it('review: only the homeroom teacher (or admin) sends to review', async () => {
      expect((await transition(other, 'review')).status).toBe(403);
      expect((await transition(english, 'review')).status).toBe(403);
      expect((await transition(director, 'review')).status).toBe(403);
      expect((await transition(guardian, 'review')).status).toBe(403);
      const res = await transition(viry, 'review');
      expect(res.status).toBe(200);
      expect((res.body as PeriodGroupStatusView).status).toBe('IN_REVIEW');
      expect((await transition(viry, 'review')).status).toBe(409);
    });

    it('IN_REVIEW: adjustments, observations and notes yes; activities and grades no', async () => {
      const view = await results();
      expect(view.status).toBe('IN_REVIEW');
      const row = byList(view, 4);
      expect(
        (await as(viry).patch(`/period-results/${row.id}`, { observations: { general: 'Bien.' } }))
          .status,
      ).toBe(200);
      const note = await as(viry).post(`/students/${row.student.id}/notes`, {
        kind: 'ACADEMICO',
        text: 'Revisó su cuaderno.',
        date: '2026-11-25',
      });
      expect(note.status).toBe(201);
      const created = await as(viry).post('/activities', {
        groupId: school.group5B.id,
        periodId: school.period.id,
        fieldKey: 'etica',
        component: 'EXAMEN',
        name: 'Otra',
        date: '2026-11-20',
      });
      expect(created.status).toBe(409);
      expect(created.body.code).toBe('PERIOD_NOT_OPEN');
      // The group's own status is shown in the group view.
      expect((await as(viry).get(`/groups/${school.group5B.id}`)).body.currentPeriod.status).toBe(
        'IN_REVIEW',
      );
    });

    it('close: not the teacher (school setting off), not the director without permission', async () => {
      expect((await transition(viry, 'close')).status).toBe(403);
      expect((await transition(director, 'close')).status).toBe(403);
      expect((await transition(english, 'close')).status).toBe(403);
    });

    let snapshot: PeriodResultsView;
    it('admin closes: snapshot stored and equal to the Excel', async () => {
      const res = await transition(admin, 'close');
      expect(res.status).toBe(200);
      expect((res.body as PeriodGroupStatusView).status).toBe('CLOSED');
      snapshot = await results();
      expect(snapshot.status).toBe('CLOSED');
      expect(snapshot.can).toMatchObject({ edit: false, close: false });
      for (const expected of golden.students) {
        const row = byList(snapshot, expected.listNumber);
        expect(row.source).toBe('snapshot');
        expect(row.snapshotAt).not.toBeNull();
        for (const key of FIELDS) {
          const field = row.fields.find((f) => f.fieldKey === key)!;
          expect(field.calculated).toBeCloseTo(expected.expected[key].calculated, 4);
          expect(field.rounded).toBe(expected.expected[key].rounded);
          expect(field.final).toBe(expected.expected[key].final);
          expect(field.components.DESEMPENO.value).not.toBeNull();
        }
        expect(row.generalAverage).toBe(expected.expected.generalAverage);
      }
    });

    it('after closing: editing activities, grades, results or notes is rejected and the snapshot does not change', async () => {
      const activities = (
        await as(viry).get(`/groups/${school.group5B.id}/activities?periodId=${school.period.id}`)
      ).body as ActivityView[];
      const activity = activities[0]!;
      const edit = await as(viry).patch(`/activities/${activity.id}`, { name: 'Cambio' });
      expect(edit.status).toBe(409);
      const row = byList(snapshot, 1);
      const grades = await as(viry).put(`/activities/${activity.id}/grades`, {
        grades: [{ studentId: row.student.id, status: 'SCORED', score: 1 }],
      });
      expect([409, 422]).toContain(grades.status);
      expect(
        (await as(viry).patch(`/period-results/${row.id}`, { legendOverride: 'x' })).status,
      ).toBe(409);
      expect(
        (
          await as(viry).post(`/students/${row.student.id}/notes`, {
            kind: 'ACADEMICO',
            text: 'Tarde.',
            date: '2026-11-25',
          })
        ).status,
      ).toBe(409);
      // Even the admin cannot change grades of a closed period.
      expect(
        (
          await as(admin).put(`/activities/${activity.id}/grades`, {
            grades: [{ studentId: row.student.id, status: 'SCORED', score: 1 }],
          })
        ).status,
      ).toBe(409);
      const again = await results();
      expect(again.rows).toEqual(snapshot.rows);
    });

    it('publish: admin or director with "Cerrar y publicar periodos"; never the teacher', async () => {
      expect((await transition(viry, 'publish')).status).toBe(403);
      expect((await transition(director, 'publish')).status).toBe(403);
      const grant = await as(admin).post('/permission-grants', {
        userId: school.director.id,
        action: 'period:update',
        scope: { type: 'GROUP', groupId: school.group5B.id },
        reason: 'Publicación de boletas',
      });
      expect(grant.status).toBe(201);
      const res = await transition(director, 'publish');
      expect(res.status).toBe(200);
      expect((res.body as PeriodGroupStatusView).status).toBe('PUBLISHED');
      expect((await results()).rows).toEqual(snapshot.rows);
    });

    it('reopen: admin only, with a reason', async () => {
      expect(
        (await transition(director, 'reopen', { reason: 'Corrección de calificación' })).status,
      ).toBe(403);
      expect(
        (await transition(viry, 'reopen', { reason: 'Corrección de calificación' })).status,
      ).toBe(403);
      expect((await transition(admin, 'reopen', {})).status).toBe(400);
      expect((await transition(admin, 'reopen', { reason: '  ' })).status).toBe(400);
      expect((await transition(admin, 'reopen', { reason: 'no' })).status).toBe(400);
      const res = await transition(admin, 'reopen', { reason: 'Corrección de una calificación' });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        status: 'OPEN',
        reopenReason: 'Corrección de una calificación',
      });
      const view = await results();
      expect(view.status).toBe('OPEN');
      expect(view.rows.every((r) => r.source === 'live')).toBe(true);
      // Adjustments and observations are kept.
      expect(byList(view, 4).observations.general).toBe('Bien.');
    });

    it('with "cierre por maestro" enabled the homeroom teacher closes their group', async () => {
      expect((await as(admin).patch('/school', { teacherCanClosePeriod: true })).status).toBe(200);
      expect((await results()).can.close).toBe(true);
      expect((await transition(other, 'close')).status).toBe(403);
      const res = await transition(viry, 'close');
      expect(res.status).toBe(200);
      expect((res.body as PeriodGroupStatusView).status).toBe('CLOSED');
    });

    it('lists the status of every group of the period', async () => {
      const res = await as(admin).get(`/periods/${school.period.id}/groups`);
      expect(res.status).toBe(200);
      const list = res.body as PeriodGroupStatusView[];
      expect(list.find((g) => g.groupId === school.group5B.id)).toMatchObject({
        status: 'CLOSED',
        studentCount: 20,
      });
      expect(list.find((g) => g.groupId === school.group4A.id)).toMatchObject({ status: 'OPEN' });
      expect((await as(guardian).get(`/periods/${school.period.id}/groups`)).status).toBe(403);
    });
  });

  describe('report cards', () => {
    const pdfPath = () =>
      `/groups/${school.group5B.id}/report-cards.pdf?periodId=${school.period.id}`;
    const docxPath = () =>
      `/groups/${school.group5B.id}/report-cards.docx?periodId=${school.period.id}`;

    it('access: homeroom, director and admin; not subject teachers, others or guardians', async () => {
      for (const token of [english, other, guardian]) {
        expect((await as(token).get(docxPath())).status).toBe(403);
        expect((await as(token).get(pdfPath())).status).toBe(403);
      }
    });

    it('Word: one section per student, opens with mammoth without errors', async () => {
      await ctx
        .http()
        .put('/api/v1/school/logo')
        .set('Authorization', `Bearer ${admin}`)
        .attach('file', TINY_PNG, 'logo.png')
        .expect(200);
      await ctx
        .http()
        .put('/api/v1/me/logo')
        .set('Authorization', `Bearer ${viry}`)
        .attach('file', TINY_PNG, 'logo.png')
        .expect(200);
      const res = await binary(as(director).get(docxPath()));
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('wordprocessingml');
      expect(res.headers['content-disposition']).toContain(
        encodeURIComponent('Boletas 5°B - Periodo I.docx'),
      );
      const { value, messages } = await mammoth.extractRawText({ buffer: res.body as Buffer });
      expect(messages.filter((m) => m.type === 'error')).toEqual([]);
      expect(value).toContain('Resultados individuales · Evaluación formativa');
      expect(value).toContain('Nombre y firma de padre, madre o tutor');
      expect(value.match(/Resultados individuales/g)).toHaveLength(20);
    });

    // Generating the PDF needs Chrome/Chromium; access rules above are checked even without it.
    const withChromium = findChromium() ? it : it.skip;
    if (!findChromium()) {
      console.warn('Sin Chrome/Chromium: se omite la generación real de boletas en PDF.');
    }

    withChromium(
      'PDF of the Periodo I fixture: 20 pages, named "Boletas 5°B - Periodo I.pdf"',
      async () => {
        const res = await binary(as(viry).get(pdfPath()));
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toBe('application/pdf');
        expect(res.headers['content-disposition']).toContain(
          encodeURIComponent('Boletas 5°B - Periodo I.pdf'),
        );
        const pdf = await PDFDocument.load(res.body as Buffer);
        expect(pdf.getPageCount()).toBe(20);
        const { width, height } = pdf.getPage(0).getSize();
        expect([Math.round(width), Math.round(height)]).toEqual([612, 792]); // letter

        const row = byList(await results(), 2);
        const single = await binary(
          as(viry).get(`/students/${row.student.id}/report-card.pdf?periodId=${school.period.id}`),
        );
        expect(single.status).toBe(200);
        expect((await PDFDocument.load(single.body as Buffer)).getPageCount()).toBe(1);
      },
      120_000,
    );

    withChromium(
      'visual: saves a PNG of the first report card for manual review',
      async () => {
        const browser = await puppeteer.launch({
          executablePath: findChromium()!,
          headless: true,
          args: ['--no-sandbox'],
        });
        try {
          const page = await browser.newPage();
          // Logos that look like logos (the fixture is anonymized; no real images).
          await page.setViewport({ width: 240, height: 240 });
          await page.setContent(
            '<body style="margin:0"><div style="width:240px;height:240px;border-radius:50%;background:#1F3A7A;color:#fff;font:bold 64px Arial;display:flex;align-items:center;justify-content:center">ESC</div></body>',
          );
          const schoolLogo = Buffer.from(
            await page.screenshot({ type: 'png', omitBackground: true }),
          );
          await page.setContent(
            '<body style="margin:0"><div style="width:240px;height:240px;border-radius:24px;background:#F8CBAD;color:#1F3A7A;font:bold 56px Arial;display:flex;align-items:center;justify-content:center">5°B</div></body>',
          );
          const teacherLogo = Buffer.from(
            await page.screenshot({ type: 'png', omitBackground: true }),
          );
          await ctx
            .http()
            .put('/api/v1/school/logo')
            .set('Authorization', `Bearer ${admin}`)
            .attach('file', schoolLogo, 'logo.png')
            .expect(200);
          await ctx
            .http()
            .put('/api/v1/me/logo')
            .set('Authorization', `Bearer ${viry}`)
            .attach('file', teacherLogo, 'logo.png')
            .expect(200);

          const html = await as(viry).get(
            `/groups/${school.group5B.id}/report-cards.html?periodId=${school.period.id}`,
          );
          expect(html.status).toBe(200);
          expect(html.text).not.toContain('BORRADOR'); // closed
          await page.setViewport({ width: 900, height: 1200, deviceScaleFactor: 1 });
          await page.setContent(html.text, { waitUntil: 'load' });
          const card = await page.$('.card');
          const dir = join(__dirname, '__snapshots__');
          mkdirSync(dir, { recursive: true });
          const png = Buffer.from(await card!.screenshot({ type: 'png' }));
          writeFileSync(join(dir, 'report-card-page1.png'), png);
          expect(png.length).toBeGreaterThan(10_000);
        } finally {
          await browser.close();
        }
      },
      120_000,
    );

    it('preview before closing shows the BORRADOR watermark', async () => {
      await transition(admin, 'reopen', { reason: 'Revisión de observaciones' }).expect(200);
      const html = await as(viry).get(
        `/groups/${school.group5B.id}/report-cards.html?periodId=${school.period.id}&studentId=${byList(await results(), 1).student.id}`,
      );
      expect(html.status).toBe(200);
      expect(html.text).toContain('BORRADOR');
      expect(html.text.match(/class="card"/g)).toHaveLength(1);
    });
  });
});
