import { Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import {
  type AssignmentView,
  type CreateAssignmentInput,
  type CreateGroupInput,
  type GroupView,
  type RosterEntry,
  Role,
  type UpdateGroupInput,
} from '@siseep/shared';
import type { ClientSession, Connection, Model, Types } from 'mongoose';
import { Errors } from '../common/app.exception';
import type { Actor } from '../common/request-user';
import { assertCan, oid, scopedQuery, studentFullName, teacherSummary } from '../common/scope';
import { Period } from '../periods/period.schema';
import { SchoolYear } from '../school-years/school-year.schema';
import { Enrollment } from '../students/enrollment.schema';
import { Student } from '../students/student.schema';
import { User } from '../users/user.schema';
import { Group, type GroupDocument, groupName } from './group.schema';
import { TeachingAssignment } from './teaching-assignment.schema';

type Person = { _id: Types.ObjectId; firstName: string; lastName: string; email: string };

@Injectable()
export class GroupsService {
  constructor(
    @InjectModel(Group.name) private readonly groupModel: Model<Group>,
    @InjectModel(TeachingAssignment.name)
    private readonly assignmentModel: Model<TeachingAssignment>,
    @InjectModel(SchoolYear.name) private readonly yearModel: Model<SchoolYear>,
    @InjectModel(Period.name) private readonly periodModel: Model<Period>,
    @InjectModel(Enrollment.name) private readonly enrollmentModel: Model<Enrollment>,
    @InjectModel(Student.name) private readonly studentModel: Model<Student>,
    @InjectModel(User.name) private readonly userModel: Model<User>,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  /** Groups the actor can see: all for admin/director, only assigned ones for teachers. */
  async list(actor: Actor, schoolYearId?: string): Promise<GroupView[]> {
    const scope = scopedQuery(actor, 'Group');
    if (!scope) return [];
    const filter = {
      $and: [
        scope,
        { deletedAt: null },
        ...(schoolYearId ? [{ schoolYearId: oid(schoolYearId) }] : []),
      ],
    };
    const groups = await this.groupModel.find(filter).sort({ grade: 1, letter: 1 }).exec();
    return this.toViews(groups);
  }

  /** Loads a group the actor can read, or throws 404 / 403. */
  async load(id: string, actor: Actor): Promise<GroupDocument> {
    const group = await this.groupModel
      .findOne({ _id: id, schoolId: actor.user.schoolId, deletedAt: null })
      .exec();
    if (!group) throw Errors.notFound('El grupo no existe.');
    assertCan(actor.ability, 'read', 'Group', group);
    return group;
  }

  async get(id: string, actor: Actor): Promise<GroupView> {
    const [view] = await this.toViews([await this.load(id, actor)]);
    return view!;
  }

  async create(input: CreateGroupInput, actor: Actor): Promise<GroupView> {
    const schoolId = actor.user.schoolId;
    const year = await this.yearModel.findOne({ _id: input.schoolYearId, schoolId }).exec();
    if (!year) throw Errors.notFound('El ciclo escolar no existe.');
    assertCan(actor.ability, 'create', 'Group', { schoolId });
    const name = groupName(input.grade, input.letter);
    if (await this.groupModel.exists({ schoolYearId: year._id, name, deletedAt: null })) {
      throw Errors.conflict(`Ya existe el grupo ${name} en el ciclo ${year.name}.`);
    }
    if (input.homeroomTeacherId) await this.requireTeacher(input.homeroomTeacherId, actor);

    let group!: GroupDocument;
    await this.connection.transaction(async (session) => {
      const docs = await this.groupModel.create(
        [
          {
            schoolId,
            schoolYearId: year._id,
            grade: input.grade,
            letter: input.letter,
            name,
            homeroomTeacherId: input.homeroomTeacherId ?? null,
            createdBy: actor.user.id,
          },
        ],
        { session },
      );
      group = docs[0]!;
      if (input.homeroomTeacherId) {
        await this.setHomeroom(group, input.homeroomTeacherId, actor, session);
      }
    });
    return this.get(group._id.toString(), actor);
  }

  /** Changes the homeroom teacher (also updates the HOMEROOM assignment). */
  async update(id: string, input: UpdateGroupInput, actor: Actor): Promise<GroupView> {
    const group = await this.load(id, actor);
    assertCan(actor.ability, 'update', 'Group', group);
    if (input.homeroomTeacherId) await this.requireTeacher(input.homeroomTeacherId, actor);
    await this.connection.transaction(async (session) => {
      await this.setHomeroom(group, input.homeroomTeacherId, actor, session);
    });
    return this.get(id, actor);
  }

  async addAssignment(id: string, input: CreateAssignmentInput, actor: Actor): Promise<GroupView> {
    const group = await this.load(id, actor);
    assertCan(actor.ability, 'create', 'TeachingAssignment', {
      schoolId: group.schoolId,
      groupId: group._id,
    });
    await this.requireTeacher(input.teacherId, actor);

    if (input.scope === 'HOMEROOM') {
      await this.connection.transaction(async (session) => {
        await this.setHomeroom(group, input.teacherId, actor, session);
      });
    } else {
      const exists = await this.assignmentModel.exists({
        groupId: group._id,
        teacherId: oid(input.teacherId),
        scope: 'SUBJECT',
        subjectKey: input.subjectKey,
        deletedAt: null,
      });
      if (exists) throw Errors.conflict('Esa persona ya tiene asignada esa materia en el grupo.');
      await this.assignmentModel.create({
        schoolId: group.schoolId,
        teacherId: input.teacherId,
        groupId: group._id,
        scope: 'SUBJECT',
        subjectKey: input.subjectKey,
        createdBy: actor.user.id,
      });
    }
    return this.get(id, actor);
  }

  async removeAssignment(id: string, assignmentId: string, actor: Actor): Promise<GroupView> {
    const group = await this.load(id, actor);
    const assignment = await this.assignmentModel
      .findOne({ _id: assignmentId, groupId: group._id, deletedAt: null })
      .exec();
    if (!assignment) throw Errors.notFound('La asignación no existe.');
    assertCan(actor.ability, 'delete', 'TeachingAssignment', assignment);
    await this.connection.transaction(async (session) => {
      assignment.deletedAt = new Date();
      await assignment.save({ session });
      if (assignment.scope === 'HOMEROOM') {
        await this.groupModel.updateOne(
          { _id: group._id },
          { $set: { homeroomTeacherId: null } },
          { session },
        );
      }
    });
    return this.get(id, actor);
  }

  /** The group's list ordered by N/L (active students first). */
  async roster(id: string, actor: Actor): Promise<RosterEntry[]> {
    const group = await this.load(id, actor);
    const enrollments = await this.enrollmentModel
      .find({ groupId: group._id })
      .sort({ status: 1, listNumber: 1 })
      .lean()
      .exec();
    const students = await this.studentModel
      .find({ _id: { $in: enrollments.map((e) => e.studentId) } })
      .lean()
      .exec();
    const byId = new Map(students.map((s) => [s._id.toString(), s]));
    return enrollments
      .filter((e) => byId.has(e.studentId.toString()))
      .map((e) => {
        const s = byId.get(e.studentId.toString())!;
        return {
          enrollmentId: e._id.toString(),
          listNumber: e.listNumber,
          status: e.status,
          student: {
            id: s._id.toString(),
            firstName: s.firstName,
            lastName1: s.lastName1,
            lastName2: s.lastName2,
            fullName: studentFullName(s),
          },
        };
      })
      .sort((a, b) =>
        a.status === b.status ? a.listNumber - b.listNumber : a.status === 'ACTIVE' ? -1 : 1,
      );
  }

  // ---- helpers -------------------------------------------------------------
  private async requireTeacher(userId: string, actor: Actor): Promise<void> {
    const teacher = await this.userModel
      .findOne({ _id: userId, schoolId: actor.user.schoolId, deletedAt: null })
      .lean()
      .exec();
    if (!teacher) throw Errors.notFound('La persona no existe en esta escuela.');
    if (!teacher.roles.includes(Role.TEACHER)) {
      throw Errors.badRequest('Solo se pueden asignar personas con el rol de docente.');
    }
  }

  private async setHomeroom(
    group: GroupDocument,
    teacherId: string | null | undefined,
    actor: Actor,
    session: ClientSession,
  ): Promise<void> {
    await this.assignmentModel.updateMany(
      { groupId: group._id, scope: 'HOMEROOM', deletedAt: null },
      { $set: { deletedAt: new Date() } },
      { session },
    );
    if (teacherId) {
      await this.assignmentModel.create(
        [
          {
            schoolId: group.schoolId,
            teacherId,
            groupId: group._id,
            scope: 'HOMEROOM',
            subjectKey: null,
            createdBy: actor.user.id,
          },
        ],
        { session },
      );
    }
    await this.groupModel.updateOne(
      { _id: group._id },
      { $set: { homeroomTeacherId: teacherId ?? null } },
      { session },
    );
    group.homeroomTeacherId = teacherId ? oid(teacherId) : null;
  }

  private async toViews(groups: GroupDocument[]): Promise<GroupView[]> {
    if (groups.length === 0) return [];
    const groupIds = groups.map((g) => g._id);
    const yearIds = [...new Set(groups.map((g) => g.schoolYearId.toString()))].map((id) => oid(id));
    const [years, periods, assignments, counts] = await Promise.all([
      this.yearModel
        .find({ _id: { $in: yearIds } })
        .lean()
        .exec(),
      this.periodModel
        .find({ schoolYearId: { $in: yearIds } })
        .sort({ number: 1 })
        .lean()
        .exec(),
      this.assignmentModel
        .find({ groupId: { $in: groupIds }, deletedAt: null })
        .populate<{ teacherId: Person }>({
          path: 'teacherId',
          select: 'firstName lastName email',
          model: User.name,
        })
        .lean()
        .exec(),
      this.enrollmentModel
        .aggregate<{ _id: Types.ObjectId; n: number }>([
          { $match: { groupId: { $in: groupIds }, status: 'ACTIVE' } },
          { $group: { _id: '$groupId', n: { $sum: 1 } } },
        ])
        .exec(),
    ]);
    const yearName = new Map(years.map((y) => [y._id.toString(), y.name]));
    const countBy = new Map(counts.map((c) => [c._id.toString(), c.n]));
    const today = new Date();

    return groups.map((group) => {
      const yearPeriods = periods.filter((p) => p.schoolYearId.equals(group.schoolYearId));
      // Current period: the one that contains today, else the latest that started, else the first.
      const current =
        yearPeriods.find((p) => p.startDate <= today && today <= p.endDate) ??
        [...yearPeriods].reverse().find((p) => p.startDate <= today) ??
        yearPeriods[0];
      const groupAssignments: AssignmentView[] = assignments
        .filter((a) => a.groupId.equals(group._id) && a.teacherId)
        .map((a) => ({
          id: a._id.toString(),
          groupId: a.groupId.toString(),
          teacher: teacherSummary(a.teacherId),
          scope: a.scope,
          ...(a.subjectKey ? { subjectKey: a.subjectKey } : {}),
        }));
      const homeroom = groupAssignments.find((a) => a.scope === 'HOMEROOM');
      return {
        id: group._id.toString(),
        schoolYearId: group.schoolYearId.toString(),
        schoolYearName: yearName.get(group.schoolYearId.toString()) ?? '',
        grade: group.grade,
        letter: group.letter,
        name: group.name,
        ...(homeroom ? { homeroomTeacher: homeroom.teacher } : {}),
        studentCount: countBy.get(group._id.toString()) ?? 0,
        ...(current
          ? {
              currentPeriod: {
                id: current._id.toString(),
                number: current.number,
                name: current.name,
                status: current.status,
              },
            }
          : {}),
        assignments: groupAssignments,
      };
    });
  }
}
