import type {
  ActivityView,
  CreatedAccountView,
  Paginated,
  AuditLogView,
  PeriodResultsView,
  StudentView,
} from '@siseep/shared';
import type request from 'supertest';
import { activateGuardian, createGuardian } from './guardian-helpers';
import { createTestContext, type TestContext } from './helpers';
import { type SchoolSetup, setupSchool } from './school-setup';

type Role = 'admin' | 'director' | 'teacherA' | 'teacherB' | 'english' | 'guardianA' | 'guardianB';
type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';

/**
 * Full role matrix of section 2 with 2 groups (5°B: teacher A; 4°A: teacher B), a subject teacher
 * (English in 5°B), the director, the admin and 2 guardians (A → a 5°B student, B → a 4°A one).
 * Each row: who gets which status for one request.
 */
// Permission tests: never delete or skip (see CLAUDE.md).
describe('Isolation matrix by role (section 2)', () => {
  let ctx: TestContext;
  let school: SchoolSetup;
  const tokens = {} as Record<Role, string>;
  const ids: Record<string, string> = {};
  const id = (key: string) => ids[key] ?? '';

  const call = (role: Role, method: Method, path: string, body?: object) => {
    const req = ctx.http()[method](`/api/v1${path}`).set('Authorization', `Bearer ${tokens[role]}`);
    return (body ? req.send(body) : req) as request.Test;
  };
  const ok = async (role: Role, method: Method, path: string, body?: object) => {
    const res = await call(role, method, path, body);
    if (res.status >= 300) throw new Error(`${method} ${path} → ${res.status} ${res.text}`);
    return res.body as unknown;
  };

  beforeAll(async () => {
    ctx = await createTestContext();
    school = await setupSchool(ctx);
    tokens.admin = school.adminToken;
    tokens.director = await ctx.token(school.director);
    tokens.teacherA = await ctx.token(school.viry);
    tokens.teacherB = await ctx.token(school.otherTeacher);
    tokens.english = await ctx.token(school.englishTeacher);
    ids.groupA = school.group5B.id;
    ids.groupB = school.group4A.id;
    ids.period = school.period.id;

    // One student per group.
    for (const [key, groupId] of [
      ['studentA', ids.groupA],
      ['studentB', ids.groupB],
    ] as const) {
      const student = (await ok('admin', 'post', '/students', {
        firstName: key === 'studentA' ? 'Ana' : 'Beto',
        lastName1: 'Prueba',
        lastName2: 'Matriz',
      })) as StudentView;
      ids[key] = student.id;
      await ok('admin', 'post', '/enrollments', { studentId: student.id, groupId, listNumber: 1 });
    }
    // One activity per group with a grade, and one note per student.
    for (const [suffix, teacher, groupId, studentId] of [
      ['A', 'teacherA', ids.groupA, ids.studentA],
      ['B', 'teacherB', ids.groupB, ids.studentB],
    ] as const) {
      const activity = (await ok(teacher, 'post', '/activities', {
        groupId,
        periodId: ids.period,
        fieldKey: 'saberes',
        component: 'EXAMEN',
        name: `Examen ${suffix}`,
        date: '2026-11-10',
      })) as ActivityView;
      ids[`activity${suffix}`] = activity.id;
      await ok(teacher, 'put', `/activities/${activity.id}/grades`, {
        grades: [{ studentId, status: 'SCORED', score: 8 }],
      });
      await ok(teacher, 'post', `/students/${studentId}/notes`, {
        kind: 'ACADEMICO',
        text: `Nota ${suffix}`,
        date: '2026-11-10',
        visibleToGuardians: true,
      });
      const results = (await ok(
        teacher,
        'get',
        `/groups/${groupId}/period-results?periodId=${ids.period}`,
      )) as PeriodResultsView;
      ids[`result${suffix}`] = results.rows[0]!.id;
    }
    // Guardians: A → 5°B student, B → 4°A student.
    for (const [role, teacher, studentId, phone] of [
      ['guardianA', 'teacherA', id('studentA'), '3121000001'],
      ['guardianB', 'teacherB', id('studentB'), '3121000002'],
    ] as const) {
      const res = await createGuardian(ctx, tokens[teacher], studentId, { phone });
      expect(res.status).toBe(201);
      tokens[role] = await activateGuardian(ctx, res.body as CreatedAccountView);
    }
  });

  afterAll(async () => {
    await ctx.close();
  });

  const ALL: Role[] = [
    'admin',
    'director',
    'teacherA',
    'teacherB',
    'english',
    'guardianA',
    'guardianB',
  ];
  const expectStatus = async (
    label: string,
    method: Method,
    path: () => string,
    expected: Partial<Record<Role, number>>,
    body?: () => object,
  ) => {
    const results: Record<string, number> = {};
    for (const role of ALL) {
      if (expected[role] === undefined) continue;
      results[role] = (await call(role, method, path(), body?.())).status;
    }
    expect({ label, ...results }).toEqual({ label, ...expected });
  };

  it('admin and direction: accounts, school, school years and groups (not teachers or guardians)', async () => {
    const others = { teacherA: 403, teacherB: 403, english: 403, guardianA: 403 };
    const staff = { director: 403, ...others };
    await expectStatus('users', 'get', () => '/users', { admin: 200, director: 200, ...others });
    await expectStatus(
      'school',
      'patch',
      () => '/school',
      { director: 200, ...others },
      () => ({ city: 'Colima' }),
    );
    await expectStatus(
      'create year',
      'post',
      () => '/school-years',
      { director: 201, ...others },
      () => ({
        name: '2030-2031',
        startDate: '2030-08-31',
        endDate: '2031-07-16',
      }),
    );
    await expectStatus(
      'create group',
      'post',
      () => '/groups',
      { director: 201, ...others },
      () => ({
        schoolYearId: school.year.id,
        grade: 6,
        letter: 'C',
      }),
    );
    await expectStatus(
      'create student',
      'post',
      () => '/students',
      { ...staff },
      () => ({
        firstName: 'X',
        lastName1: 'Y',
      }),
    );
    await expectStatus('grants', 'get', () => '/permission-grants', { admin: 200, ...staff });
    await expectStatus(
      'import',
      'post',
      () => '/imports/excel/commit',
      { ...staff },
      () => ({
        previewId: '0123456789abcdef01234567',
      }),
    );
  });

  it('read groups, activities and grades: admin and director all; teacher their groups; guardian none', async () => {
    await expectStatus('group A', 'get', () => `/groups/${ids.groupA}`, {
      admin: 200,
      director: 200,
      teacherA: 200,
      teacherB: 403,
      english: 200,
      guardianA: 403,
    });
    await expectStatus('grades of activity A', 'get', () => `/activities/${ids.activityA}/grades`, {
      admin: 200,
      director: 200,
      teacherA: 200,
      teacherB: 403,
      // English teacher: Saberes is not their subject.
      english: 403,
      guardianA: 403,
    });
    await expectStatus(
      'summary A',
      'get',
      () => `/groups/${ids.groupA}/summary?periodId=${ids.period}`,
      {
        admin: 200,
        director: 200,
        teacherA: 200,
        teacherB: 403,
        english: 403,
        guardianA: 403,
      },
    );
  });

  it('create and edit activities and grades: teacher of the group and admin; director only with a grant', async () => {
    await expectStatus(
      'grade A',
      'put',
      () => `/activities/${ids.activityA}/grades`,
      { admin: 200, director: 403, teacherA: 200, teacherB: 403, english: 403, guardianA: 403 },
      () => ({ grades: [{ studentId: ids.studentA, status: 'SCORED', score: 9 }] }),
    );
    await expectStatus(
      'new activity in A',
      'post',
      () => '/activities',
      { director: 403, teacherB: 403, english: 403, guardianA: 403 },
      () => ({
        groupId: ids.groupA,
        periodId: ids.period,
        fieldKey: 'saberes',
        component: 'DESEMPENO',
        name: 'No debe crearse',
        date: '2026-11-11',
      }),
    );
  });

  it('notes: teacher writes in their group; director reads only; guardian only via portal', async () => {
    const body = () => ({ kind: 'OTRO', text: 'Nota de prueba', date: '2026-11-11' });
    await expectStatus(
      'note A',
      'post',
      () => `/students/${ids.studentA}/notes`,
      { teacherA: 201, director: 403, teacherB: 403, guardianA: 403 },
      body,
    );
    await expectStatus('read notes A', 'get', () => `/students/${ids.studentA}/notes`, {
      admin: 200,
      director: 200,
      teacherA: 200,
      teacherB: 403,
      guardianA: 403,
    });
  });

  it('period adjustments and observations: homeroom teacher and admin only', async () => {
    await expectStatus(
      'result A',
      'patch',
      () => `/period-results/${ids.resultA}`,
      { admin: 200, director: 403, teacherA: 200, teacherB: 403, english: 403, guardianA: 403 },
      () => ({ observations: { general: 'Va muy bien.' } }),
    );
  });

  it('report cards: admin, director and the homeroom teacher; not other teachers or guardians', async () => {
    await expectStatus(
      'report cards A (word)',
      'get',
      () => `/groups/${ids.groupA}/report-cards.docx?periodId=${ids.period}`,
      { admin: 200, director: 200, teacherA: 200, teacherB: 403, english: 403, guardianA: 403 },
    );
  });

  it('guardian accounts: homeroom teacher, direction and admin; never other teachers or guardians', async () => {
    let n = 0;
    await expectStatus(
      'code for A',
      'post',
      () => `/students/${id('studentA')}/guardians`,
      { admin: 201, director: 201, teacherA: 201, teacherB: 403, english: 403, guardianA: 403 },
      () => ({
        firstName: 'Tutor',
        lastName: 'Matriz',
        relationship: 'TUTOR',
        phone: `313000000${n++}`,
      }),
    );
  });

  it('audit log: admin and director all; teachers only their groups; guardians never', async () => {
    const total = async (role: Role) =>
      ((await ok(role, 'get', '/audit?limit=100')) as Paginated<AuditLogView>).items;
    const all = await total('admin');
    expect((await total('director')).length).toBe(all.length);
    expect((await total('teacherA')).every((i) => i.groupId === ids.groupA)).toBe(true);
    expect((await total('teacherB')).every((i) => i.groupId === ids.groupB)).toBe(true);
    expect((await call('guardianA', 'get', '/audit')).status).toBe(403);
  });

  it('guardian portal: each family only sees their own child (404 otherwise); staff cannot use it', async () => {
    for (const path of [
      (s: string) => `/me/children/${s}/overview?periodId=${ids.period}`,
      (s: string) => `/me/children/${s}/activities?periodId=${ids.period}`,
      (s: string) => `/me/children/${s}/notes?periodId=${ids.period}`,
      (s: string) => `/me/children/${s}/report-cards`,
    ]) {
      expect((await call('guardianA', 'get', path(id('studentA')))).status).toBe(200);
      expect((await call('guardianA', 'get', path(id('studentB')))).status).toBe(404);
      expect((await call('guardianB', 'get', path(id('studentB')))).status).toBe(200);
      expect((await call('guardianB', 'get', path(id('studentA')))).status).toBe(404);
    }
    for (const role of ['director', 'teacherA', 'english'] as const) {
      expect((await call(role, 'get', '/me/children')).status).toBe(403);
    }
  });

  it('close, publish and reopen: teacher only asks for review; the direction and the admin close and reopen', async () => {
    const t = (action: string) => () => `/periods/${ids.period}/groups/${ids.groupA}/${action}`;
    // The direction may close: here it is blocked only because grades are missing (422).
    await expectStatus('close A', 'post', t('close'), {
      director: 422,
      teacherA: 403,
      teacherB: 403,
      english: 403,
      guardianA: 403,
    });
    await expectStatus('review A', 'post', t('review'), {
      teacherB: 403,
      english: 403,
      director: 403,
    });
    await expectStatus('review A by its teacher', 'post', t('review'), { teacherA: 200 });
    await expectStatus(
      'reopen A',
      'post',
      t('reopen'),
      { director: 200, teacherA: 403, guardianA: 403 },
      () => ({ reason: 'Prueba de la matriz' }),
    );
  });
});
