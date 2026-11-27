import { Logger } from '@nestjs/common';
import type { ImportPreview } from '@siseep/shared';
import { Types } from 'mongoose';
import { migrate } from '../src/scripts/migrate';
import { fixtureBuffer } from './fixture';
import { createTestContext, type TestContext } from './helpers';
import { type SchoolSetup, setupSchool } from './school-setup';

/** Every stage of the winning plan (explain output), flattened. */
function stages(plan: Record<string, unknown> | undefined): string[] {
  if (!plan) return [];
  const own = typeof plan.stage === 'string' ? [plan.stage] : [];
  const children = [
    plan.inputStage,
    ...(Array.isArray(plan.inputStages) ? plan.inputStages : []),
    plan.queryPlan,
  ] as (Record<string, unknown> | undefined)[];
  return [...own, ...children.flatMap((child) => stages(child))];
}

describe('Indexes of the hot queries (explain) and production migration', () => {
  let ctx: TestContext;
  let school: SchoolSetup;
  const logger = { log: () => undefined, warn: () => undefined } as unknown as Logger;

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
    await ctx
      .http()
      .post('/api/v1/imports/excel/commit')
      .set('Authorization', `Bearer ${school.adminToken}`)
      .send({ previewId: (preview.body as ImportPreview).previewId });
  });

  afterAll(async () => {
    await ctx.close();
  });

  const explain = async (collection: string, filter: Record<string, unknown>) => {
    const result = (await ctx.connection
      .collection(collection)
      .find(filter)
      .explain('queryPlanner')) as { queryPlanner: { winningPlan: Record<string, unknown> } };
    return stages(result.queryPlanner.winningPlan);
  };
  const expectIndexed = async (collection: string, filter: Record<string, unknown>) => {
    const plan = await explain(collection, filter);
    expect({ collection, plan }).toEqual({
      collection,
      plan: expect.arrayContaining(['IXSCAN']) as unknown,
    });
    expect(plan).not.toContain('COLLSCAN');
  };

  it('group summary: activities, grades, enrollments and results use indexes', async () => {
    const groupId = new Types.ObjectId(school.group5B.id);
    const periodId = new Types.ObjectId(school.period.id);
    const activities = await ctx.connection
      .collection('activities')
      .find({ groupId, periodId, deletedAt: null })
      .toArray();
    expect(activities.length).toBe(30);
    await expectIndexed('activities', { groupId, periodId, deletedAt: null });
    await expectIndexed('grades', {
      groupId,
      periodId,
      activityId: { $in: activities.map((a) => a._id) },
    });
    await expectIndexed('enrollments', { groupId, status: 'ACTIVE' });
    await expectIndexed('periodResults', { groupId, periodId });
  });

  it('grades of one activity use an index', async () => {
    const activity = await ctx.connection.collection('activities').findOne({});
    await expectIndexed('grades', { activityId: activity!._id });
  });

  it('/me/children: guardian links, enrollments and notes use indexes', async () => {
    const someone = new Types.ObjectId();
    await expectIndexed('guardianLinks', {
      guardianUserId: someone,
      schoolId: new Types.ObjectId(school.admin.schoolId),
      status: 'ACTIVE',
    });
    await expectIndexed('enrollments', { studentId: { $in: [someone] } });
    await expectIndexed('studentNotes', {
      studentId: someone,
      deletedAt: null,
      visibleToGuardians: true,
    });
  });

  it('migrate:prod is idempotent: indexes, the school, 2026-2027 and its grading scheme', async () => {
    const first = await migrate(ctx.connection, logger);
    const second = await migrate(ctx.connection, logger);
    expect(second).toEqual(first);
    const schemes = await ctx.connection
      .collection('gradingSchemes')
      .find({ schoolYearId: new Types.ObjectId(first.schoolYearId) })
      .toArray();
    expect(schemes).toHaveLength(1);
    expect(schemes[0]!.lowThreshold).toBe(7);
    expect(schemes[0]!.fields).toHaveLength(4);
  });
});
