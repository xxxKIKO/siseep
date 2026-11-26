import type {
  ActivityGradesView,
  ActivityView,
  AuditLogView,
  GradeConflict,
  ImportPreview,
  NoteView,
  Paginated,
  SaveGradesResult,
  StudentGradesView,
  StudentView,
} from '@siseep/shared';
import { Types } from 'mongoose';
import type request from 'supertest';
import { findChromium } from '../src/reports/pdf.service';
import { fixtureBuffer } from './fixture';
import { createTestContext, type TestContext } from './helpers';
import { type SchoolSetup, setupSchool } from './school-setup';

// Permission tests included: never delete or skip (see CLAUDE.md).
describe('Daily capture (e2e)', () => {
  let ctx: TestContext;
  let school: SchoolSetup;
  let viry: string;
  let english: string;
  let other: string;
  let director: string;
  let studentIds: string[];

  const as = (token: string) => ({
    get: (path: string) => ctx.http().get(`/api/v1${path}`).set('Authorization', `Bearer ${token}`),
    post: (path: string, body?: object) =>
      ctx.http().post(`/api/v1${path}`).set('Authorization', `Bearer ${token}`).send(body),
    put: (path: string, body?: object) =>
      ctx.http().put(`/api/v1${path}`).set('Authorization', `Bearer ${token}`).send(body),
    patch: (path: string, body?: object) =>
      ctx.http().patch(`/api/v1${path}`).set('Authorization', `Bearer ${token}`).send(body),
    delete: (path: string) =>
      ctx.http().delete(`/api/v1${path}`).set('Authorization', `Bearer ${token}`),
  });

  const newActivity = (token: string, body: object = {}) =>
    as(token).post('/activities', {
      groupId: school.group5B.id,
      periodId: school.period.id,
      fieldKey: 'saberes',
      component: 'DESEMPENO',
      name: `Actividad ${Math.random().toString(36).slice(2, 8)}`,
      date: '2026-11-20',
      ...body,
    });

  const setPeriodStatus = (status: string) =>
    ctx.connection.collection('periods').updateOne({}, { $set: { status } });

  beforeAll(async () => {
    ctx = await createTestContext();
    school = await setupSchool(ctx);
    // The 20 students of the 5°B come from the (anonymized) Excel.
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
    english = await ctx.token(school.englishTeacher);
    other = await ctx.token(school.otherTeacher);
    director = await ctx.token(school.director);
    const roster = await as(viry).get(`/groups/${school.group5B.id}/roster`);
    studentIds = roster.body.map((e: { student: { id: string } }) => e.student.id);
    expect(studentIds).toHaveLength(20);
  });

  afterAll(async () => {
    await ctx.close();
  });

  describe('activities', () => {
    it('the homeroom teacher creates an activity visible to guardians 24 h later', async () => {
      const before = Date.now();
      const res = await newActivity(viry, { name: 'Tabla del 7', medium: 'Libreta' });
      expect(res.status).toBe(201);
      const activity = res.body as ActivityView;
      expect(activity).toMatchObject({
        name: 'Tabla del 7',
        medium: 'Libreta',
        visibleToGuardians: true,
        gradedCount: 0,
        studentCount: 20,
      });
      const delay = new Date(activity.visibleFrom).getTime() - before;
      expect(delay).toBeGreaterThan(23.9 * 3600_000);
      expect(delay).toBeLessThan(24.1 * 3600_000);

      const dup = await newActivity(viry, { name: 'Tabla del 7' });
      expect(dup.status).toBe(409);
    });

    it('allows COMPLEMENTARIA only in fields with a complementary subject, and only that subject', async () => {
      expect(
        (await newActivity(viry, { component: 'COMPLEMENTARIA', subjectKey: 'ingles' })).status,
      ).toBe(400);
      expect(
        (
          await newActivity(viry, {
            fieldKey: 'lenguajes',
            component: 'COMPLEMENTARIA',
            subjectKey: 'ed_fisica',
          })
        ).status,
      ).toBe(400);
      expect(
        (
          await newActivity(viry, {
            fieldKey: 'lenguajes',
            component: 'COMPLEMENTARIA',
            subjectKey: 'ingles',
          })
        ).status,
      ).toBe(201);
    });

    it('a subject teacher only creates activities of their subject', async () => {
      expect((await newActivity(english, { fieldKey: 'lenguajes' })).status).toBe(403);
      expect((await newActivity(english)).status).toBe(403);
      const ok = await newActivity(english, {
        fieldKey: 'lenguajes',
        component: 'COMPLEMENTARIA',
        subjectKey: 'ingles',
        name: 'Vocabulario',
      });
      expect(ok.status).toBe(201);
    });

    it('a teacher of another group receives 403', async () => {
      expect((await newActivity(other)).status).toBe(403);
    });

    it('rejects activities when the period is not OPEN', async () => {
      await setPeriodStatus('CLOSED');
      const res = await newActivity(viry);
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('PERIOD_NOT_OPEN');
      await setPeriodStatus('OPEN');
    });

    it('filters by component', async () => {
      const res = await as(viry).get(
        `/groups/${school.group5B.id}/activities?periodId=${school.period.id}&fieldKey=saberes&component=EXAMEN`,
      );
      expect((res.body as ActivityView[]).map((a) => a.name).sort()).toEqual([
        'Ciencias',
        'Matemáticas',
      ]);
    });
  });

  describe('grades', () => {
    let activity: ActivityView;

    beforeAll(async () => {
      activity = (await newActivity(viry, { name: 'Dictado' })).body as ActivityView;
    });

    it('returns the list by N/L with null grades', async () => {
      const res = await as(viry).get(`/activities/${activity.id}/grades`);
      expect(res.status).toBe(200);
      const view = res.body as ActivityGradesView;
      expect(view.rows.map((r) => r.student.listNumber)).toEqual(
        Array.from({ length: 20 }, (_, i) => i + 1),
      );
      expect(view.rows.every((r) => r.grade === null)).toBe(true);
      expect(view.rows[0]!.student.shortName.split(' ')).toHaveLength(2);
    });

    it('saves a valid batch of 20 (NE as 0, NA as null)', async () => {
      const grades = studentIds.map((studentId, i) =>
        i === 0
          ? { studentId, status: 'NOT_DELIVERED', score: 9 }
          : i === 1
            ? { studentId, status: 'EXCUSED' }
            : { studentId, status: 'SCORED', score: (i % 10) + 0.5 > 10 ? 10 : (i % 10) + 0.5 },
      );
      const res = await as(viry).put(`/activities/${activity.id}/grades`, { grades });
      expect(res.status).toBe(200);
      const saved = (res.body as SaveGradesResult).saved;
      expect(saved).toHaveLength(20);
      expect(saved.find((g) => g.studentId === studentIds[0])).toMatchObject({
        status: 'NOT_DELIVERED',
        score: 0,
      });
      expect(saved.find((g) => g.studentId === studentIds[1])).toMatchObject({
        status: 'EXCUSED',
        score: null,
      });

      const list = (
        await as(viry).get(`/groups/${school.group5B.id}/activities?periodId=${school.period.id}`)
      ).body as ActivityView[];
      expect(list.find((a) => a.id === activity.id)?.gradedCount).toBe(20);
    });

    it('rejects 14 and more than one decimal', async () => {
      for (const score of [14, 8.55, -1]) {
        const res = await as(viry).put(`/activities/${activity.id}/grades`, {
          grades: [{ studentId: studentIds[2], status: 'SCORED', score }],
        });
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('VALIDATION_ERROR');
      }
    });

    it('rejects students of another group', async () => {
      const outsider = (
        await as(school.adminToken).post('/students', { firstName: 'Fuera', lastName1: 'Delgrupo' })
      ).body as StudentView;
      await as(school.adminToken).post('/enrollments', {
        studentId: outsider.id,
        groupId: school.group4A.id,
        listNumber: 1,
      });
      const res = await as(viry).put(`/activities/${activity.id}/grades`, {
        grades: [{ studentId: outsider.id, status: 'SCORED', score: 9 }],
      });
      expect(res.status).toBe(422);
      expect(res.body).toMatchObject({
        code: 'INVALID_STUDENTS',
        details: [{ studentId: outsider.id }],
      });
    });

    it('returns 409 with the current value when someone else changed the grade', async () => {
      const studentId = studentIds[5]!;
      const current = (
        (await as(viry).get(`/activities/${activity.id}/grades`)).body as ActivityGradesView
      ).rows.find((r) => r.student.id === studentId)!.grade!;

      const first = await as(viry).put(`/activities/${activity.id}/grades`, {
        grades: [{ studentId, status: 'SCORED', score: 6, expectedUpdatedAt: current.updatedAt }],
      });
      expect(first.status).toBe(200);
      const newVersion = (first.body as SaveGradesResult).saved[0]!;
      expect(newVersion.updatedAt).not.toBe(current.updatedAt);

      // Another device still has the old version.
      const stale = await as(viry).put(`/activities/${activity.id}/grades`, {
        grades: [
          { studentId, status: 'SCORED', score: 9, expectedUpdatedAt: current.updatedAt },
          { studentId: studentIds[6], status: 'SCORED', score: 9 },
        ],
      });
      expect(stale.status).toBe(409);
      expect(stale.body.code).toBe('GRADE_CONFLICT');
      expect(stale.body.details as GradeConflict[]).toEqual([
        {
          studentId,
          current: expect.objectContaining({ score: 6, updatedAt: newVersion.updatedAt }),
        },
      ]);
      // Nothing of the batch was saved.
      const after = (await as(viry).get(`/activities/${activity.id}/grades`))
        .body as ActivityGradesView;
      expect(after.rows.find((r) => r.student.id === studentIds[6])!.grade!.score).not.toBe(9);

      // "There was no grade" (null) also conflicts when there is one.
      const nullExpected = await as(viry).put(`/activities/${activity.id}/grades`, {
        grades: [{ studentId, status: 'SCORED', score: 7, expectedUpdatedAt: null }],
      });
      expect(nullExpected.status).toBe(409);
    });

    it('does not rewrite rows that did not change', async () => {
      const studentId = studentIds[10]!;
      const before = (
        (await as(viry).get(`/activities/${activity.id}/grades`)).body as ActivityGradesView
      ).rows.find((r) => r.student.id === studentId)!.grade!;
      const res = await as(viry).put(`/activities/${activity.id}/grades`, {
        grades: [{ studentId, status: before.status, score: before.score }],
      });
      expect((res.body as SaveGradesResult).saved[0]!.updatedAt).toBe(before.updatedAt);
    });

    it('rejects grades when the period is CLOSED', async () => {
      await setPeriodStatus('CLOSED');
      const res = await as(viry).put(`/activities/${activity.id}/grades`, {
        grades: [{ studentId: studentIds[3], status: 'SCORED', score: 9 }],
      });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('PERIOD_NOT_OPEN');
      await setPeriodStatus('OPEN');
    });

    it('the English teacher cannot read or write Saberes grades', async () => {
      expect((await as(english).get(`/activities/${activity.id}/grades`)).status).toBe(403);
      expect(
        (
          await as(english).put(`/activities/${activity.id}/grades`, {
            grades: [{ studentId: studentIds[3], status: 'SCORED', score: 9 }],
          })
        ).status,
      ).toBe(403);
      expect((await as(other).get(`/activities/${activity.id}/grades`)).status).toBe(403);
      expect((await as(director).get(`/activities/${activity.id}/grades`)).status).toBe(200);
      expect(
        (
          await as(director).put(`/activities/${activity.id}/grades`, {
            grades: [{ studentId: studentIds[3], status: 'SCORED', score: 9 }],
          })
        ).status,
      ).toBe(403);
    });

    it('records every change in the audit log with before and after', async () => {
      const studentId = studentIds[4]!;
      await as(viry).put(`/activities/${activity.id}/grades`, {
        grades: [{ studentId, status: 'SCORED', score: 3 }],
      });
      const gradeDoc = await ctx.connection.collection('grades').findOne({
        activityId: new Types.ObjectId(activity.id),
        studentId: new Types.ObjectId(studentId),
      });

      const log = await as(viry).get(`/audit?entity=grade&entityId=${gradeDoc!._id.toString()}`);
      expect(log.status).toBe(200);
      const items = (log.body as Paginated<AuditLogView>).items;
      expect(items[0]).toMatchObject({
        action: 'update',
        entity: 'grade',
        groupId: school.group5B.id,
        after: expect.objectContaining({ score: 3 }),
        actor: { id: school.viry.id },
      });
      expect((items[0]!.before as { score: number }).score).not.toBe(3);
      expect(items.at(-1)).toMatchObject({ action: 'create' });

      // Teachers only see the log of their groups; the director sees the school.
      const otherLog = await as(other).get(
        `/audit?entity=grade&entityId=${gradeDoc!._id.toString()}`,
      );
      expect((otherLog.body as Paginated<AuditLogView>).total).toBe(0);
      const directorLog = await as(director).get(
        `/audit?entity=grade&entityId=${gradeDoc!._id.toString()}`,
      );
      expect((directorLog.body as Paginated<AuditLogView>).total).toBe(items.length);
      expect((await as(await ctx.token(school.guardian)).get('/audit')).status).toBe(403);
    });

    it('deleting an activity with grades needs force and is audited', async () => {
      const blocked = await as(viry).delete(`/activities/${activity.id}`);
      expect(blocked.status).toBe(409);
      expect(blocked.body).toMatchObject({
        code: 'ACTIVITY_HAS_GRADES',
        details: { gradedCount: 20 },
      });
      expect((await as(viry).delete(`/activities/${activity.id}?force=true`)).status).toBe(204);
      expect((await as(viry).get(`/activities/${activity.id}`)).status).toBe(404);
      const log = await as(director).get(`/audit?entity=activity&entityId=${activity.id}`);
      expect((log.body as Paginated<AuditLogView>).items[0]).toMatchObject({
        action: 'delete',
        before: expect.objectContaining({ name: 'Dictado', gradedCount: 20 }),
      });
    });

    it('the student file shows grades by field, scoped by subject', async () => {
      const studentId = studentIds[0]!;
      const full = await as(viry).get(`/students/${studentId}/grades?periodId=${school.period.id}`);
      expect(full.status).toBe(200);
      expect((full.body as StudentGradesView).fields.map((f) => f.fieldKey)).toEqual([
        'lenguajes',
        'saberes',
        'etica',
        'humano',
      ]);
      const englishView = (
        await as(english).get(`/students/${studentId}/grades?periodId=${school.period.id}`)
      ).body as StudentGradesView;
      expect(englishView.fields.map((f) => f.fieldKey)).toEqual(['lenguajes']);
      expect(englishView.fields[0]!.activities.every((a) => a.subjectKey === 'ingles')).toBe(true);
      expect(
        (await as(other).get(`/students/${studentId}/grades?periodId=${school.period.id}`)).status,
      ).toBe(403);
    });
  });

  describe('student notes', () => {
    const note = (token: string, studentId: string, body: object) =>
      as(token).post(`/students/${studentId}/notes`, { date: '2026-11-20', ...body });

    it('SALUD notes are never visible to guardians, even if requested', async () => {
      const res = await note(viry, studentIds[0]!, {
        kind: 'SALUD',
        text: 'Alergia al cacahuate',
        visibleToGuardians: true,
      });
      expect(res.status).toBe(201);
      expect((res.body as NoteView).visibleToGuardians).toBe(false);
      const stored = await ctx.connection.collection('studentNotes').findOne({ kind: 'SALUD' });
      expect(stored?.visibleToGuardians).toBe(false);

      const academic = await note(viry, studentIds[1]!, {
        kind: 'ACADEMICO',
        text: 'Mejoró en lectura',
        visibleToGuardians: true,
      });
      expect((academic.body as NoteView).visibleToGuardians).toBe(true);
      // Changing it to SALUD hides it again.
      const changed = await as(viry).patch(`/notes/${academic.body.id}`, {
        kind: 'SALUD',
        visibleToGuardians: true,
      });
      expect(changed.status).toBe(200);
      expect((changed.body as NoteView).visibleToGuardians).toBe(false);
    });

    it('lists the notes of the day and of a student, within scope', async () => {
      await note(viry, studentIds[2]!, {
        kind: 'CONDUCTA',
        text: 'Participó mucho',
        fieldKey: 'etica',
      });
      const today = await as(viry).get(`/groups/${school.group5B.id}/notes?date=2026-11-20`);
      expect(today.status).toBe(200);
      expect((today.body as NoteView[]).length).toBeGreaterThanOrEqual(3);
      expect((today.body as NoteView[])[0]).toMatchObject({
        canEdit: true,
        author: { id: school.viry.id },
      });

      const byStudent = await as(viry).get(
        `/students/${studentIds[2]}/notes?periodId=${school.period.id}`,
      );
      expect((byStudent.body as NoteView[]).map((n) => n.text)).toEqual(['Participó mucho']);

      const forDirector = await as(director).get(
        `/groups/${school.group5B.id}/notes?date=2026-11-20`,
      );
      expect(forDirector.status).toBe(200);
      expect((forDirector.body as NoteView[]).every((n) => n.canEdit === false)).toBe(true);
      expect(
        (await as(english).get(`/groups/${school.group5B.id}/notes?date=2026-11-20`)).status,
      ).toBe(403);
      expect(
        (await as(other).get(`/groups/${school.group5B.id}/notes?date=2026-11-20`)).status,
      ).toBe(403);
    });

    it('teachers edit only their own notes; the director cannot write notes', async () => {
      const adminNote = await note(school.adminToken, studentIds[3]!, {
        kind: 'OTRO',
        text: 'Nota de la dirección',
      });
      expect(adminNote.status).toBe(201);
      expect((await as(viry).patch(`/notes/${adminNote.body.id}`, { text: 'Cambio' })).status).toBe(
        403,
      );
      expect((await as(viry).delete(`/notes/${adminNote.body.id}`)).status).toBe(403);
      expect((await note(director, studentIds[3]!, { kind: 'OTRO', text: 'x' })).status).toBe(403);

      const mine = await note(viry, studentIds[3]!, {
        kind: 'RECONOCIMIENTO',
        text: 'Ganó el concurso',
      });
      expect((await as(viry).delete(`/notes/${mine.body.id}`)).status).toBe(204);
      const log = await as(viry).get(`/audit?entity=note&entityId=${mine.body.id}`);
      expect((log.body as Paginated<AuditLogView>).items.map((i) => i.action)).toEqual([
        'delete',
        'create',
      ]);
    });

    it('rejects dates outside the periods', async () => {
      const res = await note(viry, studentIds[0]!, { kind: 'OTRO', text: 'x', date: '2027-08-20' });
      expect(res.status).toBe(400);
    });
  });

  describe('capture sheet PDF', () => {
    const binary = (req: request.Test) =>
      req.buffer(true).parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });

    // Generating the PDF needs Chrome/Chromium; access rules are checked even without it.
    const withChromium = findChromium() ? it : it.skip;
    if (!findChromium()) {
      console.warn(
        'Sin Chrome/Chromium: se omite la generación real del PDF (configura CHROMIUM_PATH).',
      );
    }

    withChromium(
      'prints the list of the group for an activity and blank',
      async () => {
        const activity = (await newActivity(viry, { name: 'Lectura en voz alta' }))
          .body as ActivityView;
        const res = await binary(
          as(viry).get(`/groups/${school.group5B.id}/capture-sheet.pdf?activityId=${activity.id}`),
        );
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toBe('application/pdf');
        expect((res.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
        expect(res.headers['content-disposition']).toContain(
          encodeURIComponent('Lectura en voz alta'),
        );

        const blank = await binary(as(viry).get(`/groups/${school.group5B.id}/capture-sheet.pdf`));
        expect(blank.status).toBe(200);
      },
      60_000,
    );

    it('a teacher of another group cannot download it', async () => {
      expect((await as(other).get(`/groups/${school.group5B.id}/capture-sheet.pdf`)).status).toBe(
        403,
      );
    });
  });
});
