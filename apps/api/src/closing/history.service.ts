import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  FIELD_NAMES,
  FIELD_SHORT_NAMES,
  type FieldKey,
  type GradingScheme,
  type HistoryPeriod,
  type PeriodStatus,
  type StudentHistory,
} from '@siseep/shared';
import type { Model, Types } from 'mongoose';
import { Errors } from '../common/app.exception';
import type { Actor } from '../common/request-user';
import { assertCan, oid, studentFullName } from '../common/scope';
import { GroupsService } from '../groups/groups.service';
import { PeriodResult } from '../period-results/period-result.schema';
import { PeriodStatusService } from '../periods/period-status.service';
import { Period } from '../periods/period.schema';
import { SchoolYear } from '../school-years/school-year.schema';
import { Enrollment } from '../students/enrollment.schema';
import { Student } from '../students/student.schema';
import { PeriodDataService } from '../summary/period-data.service';

const LOCKED: PeriodStatus[] = ['CLOSED', 'PUBLISHED'];

export function historyFields(scheme: GradingScheme): StudentHistory['fields'] {
  return [...scheme.fields]
    .sort((a, b) => a.order - b.order)
    .map((f) => ({
      key: f.key as FieldKey,
      name: f.name || FIELD_NAMES[f.key as FieldKey],
      shortName: FIELD_SHORT_NAMES[f.key as FieldKey],
      color: f.color,
    }));
}

/**
 * Finals per field and period of a school year (stage 6): the closing photo when the period is
 * CLOSED/PUBLISHED, the live engine calculation (with adjustments) while it is open.
 */
@Injectable()
export class HistoryService {
  constructor(
    @InjectModel(Student.name) private readonly studentModel: Model<Student>,
    @InjectModel(Enrollment.name) private readonly enrollmentModel: Model<Enrollment>,
    @InjectModel(Period.name) private readonly periodModel: Model<Period>,
    @InjectModel(SchoolYear.name) private readonly yearModel: Model<SchoolYear>,
    @InjectModel(PeriodResult.name) private readonly resultModel: Model<PeriodResult>,
    private readonly groups: GroupsService,
    private readonly periodData: PeriodDataService,
    private readonly periodStatus: PeriodStatusService,
  ) {}

  /** The student's enrollment in the year (or the current/latest one). */
  async enrollmentOf(studentId: string, schoolId: string, schoolYearId?: string) {
    if (schoolYearId) {
      return this.enrollmentModel
        .findOne({
          studentId: oid(studentId),
          schoolId: oid(schoolId),
          schoolYearId: oid(schoolYearId),
        })
        .lean()
        .exec();
    }
    const current = await this.yearModel
      .findOne({ schoolId: oid(schoolId), isCurrent: true })
      .lean()
      .exec();
    const all = await this.enrollmentModel
      .find({ studentId: oid(studentId), schoolId: oid(schoolId) })
      .sort({ from: -1 })
      .lean()
      .exec();
    return all.find((e) => current && e.schoolYearId.equals(current._id)) ?? all[0] ?? null;
  }

  /** Staff (homeroom teacher, director, admin): whoever reads the group's period results. */
  async forStudent(studentId: string, schoolYearId: string | undefined, actor: Actor) {
    const enrollment = await this.enrollmentOf(studentId, actor.user.schoolId, schoolYearId);
    if (!enrollment) throw Errors.notFound('El alumno no está inscrito en ese ciclo.');
    const group = await this.groups.load(enrollment.groupId.toString(), actor);
    assertCan(actor.ability, 'read', 'PeriodResult', {
      schoolId: group.schoolId,
      groupId: group._id,
    });
    return this.build(studentId, group, enrollment.schoolYearId);
  }

  /** Without access checks: the caller already checked them. */
  async build(
    studentId: string,
    group: { _id: Types.ObjectId; schoolYearId: Types.ObjectId },
    schoolYearId: Types.ObjectId,
  ): Promise<StudentHistory> {
    const [student, year, periods, scheme] = await Promise.all([
      this.studentModel.findById(studentId).lean().exec(),
      this.yearModel.findById(schoolYearId, { name: 1 }).lean().exec(),
      this.periodModel.find({ schoolYearId }).sort({ number: 1 }).lean().exec(),
      this.periodData.scheme(schoolYearId),
    ]);
    if (!student) throw Errors.notFound('El alumno no existe.');
    const statuses = await this.periodStatus.effectiveManyPeriods(
      periods.map((p) => p._id),
      group._id,
    );
    const snapshots = await this.resultModel
      .find({
        studentId: oid(studentId),
        periodId: { $in: periods.map((p) => p._id) },
        snapshotAt: { $ne: null },
      })
      .lean()
      .exec();
    const now = new Date();

    const result: HistoryPeriod[] = [];
    for (const period of periods) {
      const status = statuses.get(period._id.toString()) ?? period.status;
      const base = { id: period._id.toString(), number: period.number, name: period.name, status };
      const snapshot = snapshots.find((s) => s.periodId.equals(period._id));
      if (LOCKED.includes(status) && snapshot) {
        result.push({
          ...base,
          source: 'snapshot',
          values: Object.fromEntries(snapshot.fields.map((f) => [f.fieldKey, f.final ?? null])),
          generalAverage: snapshot.generalAverage ?? null,
        });
        continue;
      }
      if (period.startDate > now) {
        result.push({ ...base, source: 'none', values: {}, generalAverage: null });
        continue;
      }
      const data = await this.periodData.load(group, period._id);
      const row = data.rows.find((r) => r.student.id === studentId);
      const hasData = row?.result.fields.some((f) => f.final !== null) ?? false;
      result.push({
        ...base,
        source: hasData ? 'live' : 'none',
        values: row ? Object.fromEntries(row.result.fields.map((f) => [f.fieldKey, f.final])) : {},
        generalAverage: row?.result.generalAverage ?? null,
      });
    }
    return {
      student: { id: student._id.toString(), fullName: studentFullName(student) },
      schoolYear: { id: schoolYearId.toString(), name: year?.name ?? '' },
      fields: historyFields(scheme),
      periods: result,
    };
  }
}
