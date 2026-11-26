import type { ImportCommitResult, ImportPreview } from '@siseep/shared';
import type { Connection } from 'mongoose';
import { editedFixture, fixtureBuffer } from './fixture';
import { createTestContext, type TestContext } from './helpers';
import { type SchoolSetup, setupSchool } from './school-setup';

describe('Excel import (e2e)', () => {
  let ctx: TestContext;
  let school: SchoolSetup;
  let db: Connection;

  beforeAll(async () => {
    ctx = await createTestContext();
    school = await setupSchool(ctx);
    db = ctx.connection;
  });

  afterAll(async () => {
    await ctx.close();
  });

  const preview = (buffer: Buffer, groupId = school.group5B.id, token = school.adminToken) =>
    ctx
      .http()
      .post('/api/v1/imports/excel/preview')
      .set('Authorization', `Bearer ${token}`)
      .field('groupId', groupId)
      .field('periodId', school.period.id)
      .attach('file', buffer, 'Calificaciones y Boletas - Periodo I.xlsx');

  const commit = (previewId: string) =>
    ctx
      .http()
      .post('/api/v1/imports/excel/commit')
      .set('Authorization', `Bearer ${school.adminToken}`)
      .send({ previewId });

  const counts = async () => ({
    students: await db.collection('students').countDocuments(),
    enrollments: await db.collection('enrollments').countDocuments(),
    activities: await db.collection('activities').countDocuments(),
    grades: await db.collection('grades').countDocuments(),
    periodResults: await db.collection('periodResults').countDocuments(),
  });

  it('previews the 5°B Excel without saving anything', async () => {
    const res = await preview(fixtureBuffer());
    expect(res.status).toBe(200);
    const body = res.body as ImportPreview;

    expect(body.summary.students).toEqual({ total: 20, new: 20, existing: 0, enrolled: 0 });
    expect(body.summary.activities).toBe(30);
    expect(body.summary.activitiesByField).toEqual({
      lenguajes: { DESEMPENO: 1, PROYECTO: 4, EXAMEN: 1, COMPLEMENTARIA: 1 },
      saberes: { DESEMPENO: 2, PROYECTO: 6, EXAMEN: 2, COMPLEMENTARIA: 0 },
      etica: { DESEMPENO: 1, PROYECTO: 4, EXAMEN: 1, COMPLEMENTARIA: 0 },
      humano: { DESEMPENO: 1, PROYECTO: 4, EXAMEN: 1, COMPLEMENTARIA: 1 },
    });
    expect(body.summary.grades).toBe(600);
    expect(body.summary.adjustments).toBe(25);
    expect(body.summary.observations).toBe(20);
    expect(body.canCommit).toBe(true);
    expect(body.summary.errors).toBe(0);
    // Activities without a date take the period start and are flagged in yellow.
    expect(body.issues).toContainEqual(
      expect.objectContaining({ code: 'MISSING_DATE', severity: 'warning' }),
    );
    expect(body.activities.find((a) => a.name === 'Tabla libreta CN')?.date).toBe('2026-10-26');

    expect(await counts()).toEqual({
      students: 0,
      enrollments: 0,
      activities: 0,
      grades: 0,
      periodResults: 0,
    });
  });

  it('marks the 14 of Ética / Lotería as an error in red', async () => {
    const buffer = await editedFixture((wb) => {
      wb.getWorksheet('Ética')!.getCell('I7').value = 14;
    });
    const res = await preview(buffer);
    expect(res.status).toBe(200);
    const body = res.body as ImportPreview;
    expect(body.issues).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        code: 'OUT_OF_RANGE',
        sheet: 'Ética',
        cell: 'I7',
      }),
    );
    expect(body.summary.grades).toBe(599);
    expect(body.canCommit).toBe(true); // the cell is skipped, the rest can be imported
  });

  it('imports in one transaction and re-importing duplicates nothing', async () => {
    const first = (await preview(fixtureBuffer())).body as ImportPreview;
    const res = await commit(first.previewId);
    expect(res.status).toBe(200);
    expect(res.body as ImportCommitResult).toEqual({
      studentsCreated: 20,
      studentsReused: 0,
      enrollmentsCreated: 20,
      activitiesCreated: 30,
      activitiesUpdated: 0,
      gradesUpserted: 600,
      periodResultsUpserted: 20,
    });
    const afterFirst = await counts();
    expect(afterFirst).toEqual({
      students: 20,
      enrollments: 20,
      activities: 30,
      grades: 600,
      periodResults: 20,
    });

    // Stored data: 0 → NOT_DELIVERED, adjustments and observations in periodResults.
    expect(
      await db.collection('grades').countDocuments({ score: 0, status: 'NOT_DELIVERED' }),
    ).toBe(23);
    expect(
      await db.collection('grades').countDocuments({ score: 0, status: { $ne: 'NOT_DELIVERED' } }),
    ).toBe(0);
    const overrides = await db
      .collection('periodResults')
      .aggregate([
        { $unwind: '$fields' },
        { $match: { 'fields.override': { $ne: null } } },
        { $count: 'n' },
      ])
      .toArray();
    expect(overrides[0]?.n).toBe(25);
    const result = await db.collection('periodResults').findOne({});
    expect(result?.observations.byField.lenguajes).toContain('Observación de prueba');
    expect(await db.collection('activities').countDocuments({ subjectKey: 'ingles' })).toBe(1);

    // Second import of the same file.
    const second = (await preview(fixtureBuffer())).body as ImportPreview;
    expect(second.summary.students).toMatchObject({ new: 0, enrolled: 20 });
    const again = await commit(second.previewId);
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({
      studentsCreated: 0,
      enrollmentsCreated: 0,
      activitiesCreated: 0,
      activitiesUpdated: 30,
    });
    expect(await counts()).toEqual(afterFirst);
  });

  it('blocks the commit when a list number belongs to another student', async () => {
    const buffer = await editedFixture((wb) => {
      wb.getWorksheet('Lista')!.getCell('B4').value = 'Persona Distinta Total';
    });
    const body = (await preview(buffer)).body as ImportPreview;
    expect(body.canCommit).toBe(false);
    expect(body.issues).toContainEqual(
      expect.objectContaining({ code: 'LIST_NUMBER_TAKEN', blocking: true }),
    );
    const res = await commit(body.previewId);
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('IMPORT_BLOCKED');
  });

  it('rejects files that are not .xlsx and unknown previews', async () => {
    const bad = await preview(Buffer.from('nombre,calificación\nAna,9'));
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe('INVALID_FILE');
    const gone = await commit('aaaaaaaaaaaaaaaaaaaaaaaa');
    expect(gone.status).toBe(410);
    expect(gone.body.code).toBe('IMPORT_EXPIRED');
  });

  it('only imports into OPEN periods', async () => {
    await db.collection('periods').updateOne({}, { $set: { status: 'CLOSED' } });
    const res = await preview(fixtureBuffer());
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('PERIOD_NOT_OPEN');
    await db.collection('periods').updateOne({}, { $set: { status: 'OPEN' } });
  });

  it('is admin only', async () => {
    const res = await preview(fixtureBuffer(), school.group5B.id, await ctx.token(school.viry));
    expect(res.status).toBe(403);
  });
});
