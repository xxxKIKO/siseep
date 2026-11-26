import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  type CreateEnrollmentInput,
  type CreateStudentInput,
  dateOnlyToDate,
  dateToDateOnly,
  type Paginated,
  type StudentListQuery,
  type StudentView,
  type UpdateEnrollmentInput,
  type UpdateStudentInput,
} from '@siseep/shared';
import type { Model } from 'mongoose';
import { Errors } from '../common/app.exception';
import type { Actor } from '../common/request-user';
import { assertCan, oid, requireScopedQuery, studentFullName } from '../common/scope';
import { Group } from '../groups/group.schema';
import { Enrollment, type EnrollmentDocument } from './enrollment.schema';
import { normalizeName, searchNameOf, Student, type StudentDocument } from './student.schema';

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

@Injectable()
export class StudentsService {
  constructor(
    @InjectModel(Student.name) private readonly studentModel: Model<Student>,
    @InjectModel(Enrollment.name) private readonly enrollmentModel: Model<Enrollment>,
    @InjectModel(Group.name) private readonly groupModel: Model<Group>,
  ) {}

  /** Students of the school (admin and director). `q` searches surnames and names, accent-free. */
  async list(query: StudentListQuery, actor: Actor): Promise<Paginated<StudentView>> {
    const conditions: Record<string, unknown>[] = [
      requireScopedQuery(actor, 'Student'),
      { deletedAt: null },
    ];
    if (query.q) {
      const words = normalizeName(query.q).split(' ').filter(Boolean);
      for (const word of words) conditions.push({ searchName: new RegExp(escapeRegex(word)) });
    }
    if (query.groupId) {
      const ids = await this.enrollmentModel.distinct('studentId', { groupId: oid(query.groupId) });
      conditions.push({ _id: { $in: ids } });
    }
    const filter = { $and: conditions };
    const [total, students] = await Promise.all([
      this.studentModel.countDocuments(filter).exec(),
      this.studentModel
        .find(filter)
        .sort({ searchName: 1 })
        .skip((query.page - 1) * query.limit)
        .limit(query.limit)
        .exec(),
    ]);
    return { items: await this.toViews(students), total, page: query.page, limit: query.limit };
  }

  private async load(id: string, actor: Actor): Promise<StudentDocument> {
    const student = await this.studentModel
      .findOne({ _id: id, schoolId: actor.user.schoolId, deletedAt: null })
      .exec();
    if (!student) throw Errors.notFound('El alumno no existe.');
    assertCan(actor.ability, 'read', 'Student', student);
    return student;
  }

  async get(id: string, actor: Actor): Promise<StudentView> {
    const [view] = await this.toViews([await this.load(id, actor)]);
    return view!;
  }

  async create(input: CreateStudentInput, actor: Actor): Promise<StudentView> {
    const schoolId = actor.user.schoolId;
    assertCan(actor.ability, 'create', 'Student', { schoolId });
    await this.assertCurpFree(input.curp, schoolId);
    const student = await this.studentModel.create({
      schoolId,
      firstName: input.firstName,
      lastName1: input.lastName1,
      lastName2: input.lastName2,
      searchName: searchNameOf(input),
      curp: input.curp || null,
      birthDate: input.birthDate ? dateOnlyToDate(input.birthDate) : null,
      notes: input.notes || null,
      createdBy: actor.user.id,
    });
    return this.get(student._id.toString(), actor);
  }

  async update(id: string, input: UpdateStudentInput, actor: Actor): Promise<StudentView> {
    const student = await this.load(id, actor);
    assertCan(actor.ability, 'update', 'Student', student);
    if (input.curp && input.curp !== student.curp) {
      await this.assertCurpFree(input.curp, student.schoolId.toString());
    }
    student.set({
      ...(input.firstName ? { firstName: input.firstName } : {}),
      ...(input.lastName1 ? { lastName1: input.lastName1 } : {}),
      ...(input.lastName2 !== undefined ? { lastName2: input.lastName2 } : {}),
      ...(input.curp !== undefined ? { curp: input.curp || null } : {}),
      ...(input.birthDate !== undefined
        ? { birthDate: input.birthDate ? dateOnlyToDate(input.birthDate) : null }
        : {}),
      ...(input.notes !== undefined ? { notes: input.notes || null } : {}),
    });
    student.searchName = searchNameOf(student);
    await student.save();
    return this.get(id, actor);
  }

  // ---- Enrollments -----------------------------------------------------------
  async enroll(input: CreateEnrollmentInput, actor: Actor): Promise<StudentView> {
    const schoolId = actor.user.schoolId;
    const [student, group] = await Promise.all([
      this.load(input.studentId, actor),
      this.groupModel.findOne({ _id: input.groupId, schoolId, deletedAt: null }).exec(),
    ]);
    if (!group) throw Errors.notFound('El grupo no existe.');
    assertCan(actor.ability, 'create', 'Enrollment', { schoolId, groupId: group._id });

    const current = await this.enrollmentModel
      .findOne({ studentId: student._id, schoolYearId: group.schoolYearId })
      .exec();
    if (current) {
      const currentGroup = await this.groupModel.findById(current.groupId, { name: 1 }).lean();
      throw Errors.conflict(
        `El alumno ya está inscrito en ${currentGroup?.name ?? 'otro grupo'} en este ciclo.`,
      );
    }
    await this.assertListNumberFree(group._id.toString(), input.listNumber);
    await this.enrollmentModel.create({
      schoolId,
      studentId: student._id,
      groupId: group._id,
      schoolYearId: group.schoolYearId,
      listNumber: input.listNumber,
      from: new Date(),
      createdBy: actor.user.id,
    });
    return this.get(student._id.toString(), actor);
  }

  async updateEnrollment(
    id: string,
    input: UpdateEnrollmentInput,
    actor: Actor,
  ): Promise<StudentView> {
    const enrollment = await this.enrollmentModel
      .findOne({ _id: id, schoolId: actor.user.schoolId })
      .exec();
    if (!enrollment) throw Errors.notFound('La inscripción no existe.');
    assertCan(actor.ability, 'update', 'Enrollment', enrollment);

    const becomesActive = input.status === 'ACTIVE' && enrollment.status !== 'ACTIVE';
    if (
      (input.listNumber !== undefined && input.listNumber !== enrollment.listNumber) ||
      becomesActive
    ) {
      await this.assertListNumberFree(
        enrollment.groupId.toString(),
        input.listNumber ?? enrollment.listNumber,
        enrollment,
      );
    }
    if (input.listNumber !== undefined) enrollment.listNumber = input.listNumber;
    if (input.status && input.status !== enrollment.status) {
      enrollment.status = input.status;
      enrollment.to = input.status === 'ACTIVE' ? null : new Date();
    }
    await enrollment.save();
    return this.get(enrollment.studentId.toString(), actor);
  }

  // ---- helpers -----------------------------------------------------------------
  private async assertCurpFree(curp: string | undefined, schoolId: string): Promise<void> {
    if (!curp) return;
    if (await this.studentModel.exists({ schoolId, curp, deletedAt: null })) {
      throw Errors.conflict('Ya existe un alumno con esa CURP.');
    }
  }

  private async assertListNumberFree(
    groupId: string,
    listNumber: number,
    except?: EnrollmentDocument,
  ): Promise<void> {
    const taken = await this.enrollmentModel.exists({
      groupId: oid(groupId),
      listNumber,
      status: 'ACTIVE',
      ...(except ? { _id: { $ne: except._id } } : {}),
    });
    if (taken)
      throw Errors.conflict(`El número de lista ${listNumber} ya está ocupado en el grupo.`);
  }

  private async toViews(students: StudentDocument[]): Promise<StudentView[]> {
    const enrollments = await this.enrollmentModel
      .find({ studentId: { $in: students.map((s) => s._id) } })
      .sort({ createdAt: -1 })
      .lean()
      .exec();
    const groups = await this.groupModel
      .find({ _id: { $in: enrollments.map((e) => e.groupId) } }, { name: 1 })
      .lean()
      .exec();
    const groupName = new Map(groups.map((g) => [g._id.toString(), g.name]));

    return students.map((s) => {
      const mine = enrollments.filter((e) => e.studentId.equals(s._id));
      const enrollment = mine.find((e) => e.status === 'ACTIVE') ?? mine[0];
      return {
        id: s._id.toString(),
        firstName: s.firstName,
        lastName1: s.lastName1,
        lastName2: s.lastName2,
        fullName: studentFullName(s),
        ...(s.curp ? { curp: s.curp } : {}),
        ...(s.birthDate ? { birthDate: dateToDateOnly(s.birthDate) } : {}),
        ...(s.notes ? { notes: s.notes } : {}),
        ...(enrollment
          ? {
              enrollment: {
                id: enrollment._id.toString(),
                groupId: enrollment.groupId.toString(),
                groupName: groupName.get(enrollment.groupId.toString()) ?? '',
                listNumber: enrollment.listNumber,
                status: enrollment.status,
              },
            }
          : {}),
      };
    });
  }
}
