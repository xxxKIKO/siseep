import type { GroupView, PeriodView, SchoolYearView } from '@siseep/shared';
import type { TestContext, TestUser } from './helpers';

export interface SchoolSetup {
  admin: TestUser;
  adminToken: string;
  year: SchoolYearView;
  period: PeriodView;
  viry: TestUser;
  otherTeacher: TestUser;
  englishTeacher: TestUser;
  director: TestUser;
  guardian: TestUser;
  group5B: GroupView;
  group4A: GroupView;
}

/** Builds a school through the API: 2026-2027, Periodo I, 5°B (Viry) and 4°A (another teacher). */
export async function setupSchool(ctx: TestContext): Promise<SchoolSetup> {
  const admin = await ctx.createUser(['ADMIN']);
  const adminToken = await ctx.token(admin);
  const post = async <T>(path: string, body: object): Promise<T> => {
    const res = await ctx
      .http()
      .post(`/api/v1${path}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send(body);
    if (res.status !== 201 && res.status !== 200) {
      throw new Error(`${path} → ${res.status} ${JSON.stringify(res.body)}`);
    }
    return res.body as T;
  };

  const year = await post<SchoolYearView>('/school-years', {
    name: '2026-2027',
    startDate: '2026-08-31',
    endDate: '2027-07-16',
    isCurrent: true,
  });
  const period = await post<PeriodView>('/periods', {
    schoolYearId: year.id,
    number: 1,
    name: 'Periodo I',
    startDate: '2026-08-31',
    endDate: '2026-11-30',
    deliveryDateText: 'miércoles 18 de noviembre de 2026',
  });

  const viry = await ctx.createUser(['TEACHER']);
  const otherTeacher = await ctx.createUser(['TEACHER']);
  const englishTeacher = await ctx.createUser(['TEACHER']);
  const director = await ctx.createUser(['DIRECTOR']);
  const guardian = await ctx.createUser(['GUARDIAN']);

  const group5B = await post<GroupView>('/groups', {
    schoolYearId: year.id,
    grade: 5,
    letter: 'b',
    homeroomTeacherId: viry.id,
  });
  await post(`/groups/${group5B.id}/assignments`, {
    teacherId: englishTeacher.id,
    scope: 'SUBJECT',
    subjectKey: 'ingles',
  });
  const group4A = await post<GroupView>('/groups', {
    schoolYearId: year.id,
    grade: 4,
    letter: 'A',
    homeroomTeacherId: otherTeacher.id,
  });

  return {
    admin,
    adminToken,
    year,
    period,
    viry,
    otherTeacher,
    englishTeacher,
    director,
    guardian,
    group5B,
    group4A,
  };
}
