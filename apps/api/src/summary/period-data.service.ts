import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  DEFAULT_GRADING_SCHEME,
  type EngineActivity,
  type EngineGrade,
  type FieldOverrides,
  type GradingScheme as SchemeData,
  shortStudentName,
  type StudentPeriodResult,
  studentPeriodResult,
} from '@siseep/shared';
import type { ClientSession, Model, Types } from 'mongoose';
import { Activity } from '../activities/activity.schema';
import { Grade } from '../activities/grade.schema';
import { studentFullName } from '../common/scope';
import { GradingScheme } from '../grading-schemes/grading-scheme.schema';
import { PeriodResult } from '../period-results/period-result.schema';
import { Enrollment } from '../students/enrollment.schema';
import { Student } from '../students/student.schema';

type Lean<T> = T & { _id: Types.ObjectId };

export interface StudentPeriodData {
  student: { id: string; listNumber: number; fullName: string; shortName: string };
  result: StudentPeriodResult;
}

export interface GroupPeriodData {
  scheme: SchemeData;
  activities: Lean<Activity>[];
  grades: Lean<Grade>[];
  results: Lean<PeriodResult>[];
  /** Active students by N/L with the engine's result (stored adjustments applied). */
  rows: StudentPeriodData[];
}

/**
 * Loads everything the engine needs for one group in one period and runs it per student.
 * Shared by the live summary (stage 3) and the period closing (stage 4), so both always agree.
 */
@Injectable()
export class PeriodDataService {
  constructor(
    @InjectModel(Activity.name) private readonly activityModel: Model<Activity>,
    @InjectModel(Grade.name) private readonly gradeModel: Model<Grade>,
    @InjectModel(GradingScheme.name) private readonly schemeModel: Model<GradingScheme>,
    @InjectModel(Enrollment.name) private readonly enrollmentModel: Model<Enrollment>,
    @InjectModel(Student.name) private readonly studentModel: Model<Student>,
    @InjectModel(PeriodResult.name) private readonly resultModel: Model<PeriodResult>,
  ) {}

  async load(
    group: { _id: Types.ObjectId; schoolYearId: Types.ObjectId },
    periodId: Types.ObjectId,
    session?: ClientSession,
  ): Promise<GroupPeriodData> {
    const [schemeDoc, enrollments, activities, results] = await Promise.all([
      this.schemeModel
        .findOne({ schoolYearId: group.schoolYearId }, null, { session })
        .lean()
        .exec(),
      this.enrollmentModel
        .find({ groupId: group._id, status: 'ACTIVE' }, null, { session })
        .sort({ listNumber: 1 })
        .lean()
        .exec(),
      // Query 1: activities of the group in the period.
      this.activityModel
        .find({ groupId: group._id, periodId, deletedAt: null }, null, { session })
        .lean()
        .exec(),
      this.resultModel.find({ groupId: group._id, periodId }, null, { session }).lean().exec(),
    ]);
    // Query 2: their grades.
    const [grades, students] = await Promise.all([
      this.gradeModel
        .find(
          { groupId: group._id, periodId, activityId: { $in: activities.map((a) => a._id) } },
          null,
          { session },
        )
        .lean()
        .exec(),
      this.studentModel
        .find({ _id: { $in: enrollments.map((e) => e.studentId) } }, null, { session })
        .lean()
        .exec(),
    ]);

    const scheme: SchemeData = schemeDoc
      ? {
          fields: schemeDoc.fields,
          rounding: schemeDoc.rounding,
          lowThreshold: schemeDoc.lowThreshold,
          lowLegend: schemeDoc.lowLegend,
          minFinal: schemeDoc.minFinal,
          maxFinal: schemeDoc.maxFinal,
        }
      : DEFAULT_GRADING_SCHEME;
    const engineActivities: EngineActivity[] = activities.map((a) => ({
      id: a._id.toString(),
      fieldKey: a.fieldKey,
      component: a.component,
      subjectKey: a.subjectKey ?? null,
    }));
    const gradesByStudent = new Map<string, EngineGrade[]>();
    for (const g of grades) {
      const list = gradesByStudent.get(g.studentId.toString()) ?? [];
      list.push({ activityId: g.activityId.toString(), status: g.status, score: g.score ?? null });
      gradesByStudent.set(g.studentId.toString(), list);
    }
    const overridesBy = new Map(
      results.map((r) => [
        r.studentId.toString(),
        Object.fromEntries(
          r.fields
            .filter((f) => f.override !== null && f.override !== undefined)
            .map((f) => [f.fieldKey, f.override]),
        ) as FieldOverrides,
      ]),
    );
    const studentBy = new Map(students.map((s) => [s._id.toString(), s]));

    const rows = enrollments.flatMap((e): StudentPeriodData[] => {
      const s = studentBy.get(e.studentId.toString());
      if (!s) return [];
      const id = s._id.toString();
      return [
        {
          student: {
            id,
            listNumber: e.listNumber,
            fullName: studentFullName(s),
            shortName: shortStudentName(s),
          },
          result: studentPeriodResult(
            scheme,
            engineActivities,
            gradesByStudent.get(id) ?? [],
            overridesBy.get(id),
          ),
        },
      ];
    });

    return { scheme, activities, grades, results, rows };
  }
}
