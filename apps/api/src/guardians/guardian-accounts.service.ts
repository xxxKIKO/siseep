import { Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import {
  type CreatedAccountView,
  type CreateGuardianData,
  type GroupGuardianRow,
  type GuardianLinkView,
  MAX_GUARDIANS_PER_STUDENT,
  RELATIONSHIP_LABELS,
  Role,
  shortStudentName,
  TEMP_PASSWORD_ALPHABET,
  type TemporaryPasswordView,
} from '@siseep/shared';
import type { Connection, Model, Types } from 'mongoose';
import { PasswordService } from '../auth/password.service';
import { SessionsService } from '../auth/sessions.service';
import { AuditService } from '../audit/audit.service';
import { Errors } from '../common/app.exception';
import { temporaryPassword } from '../common/crypto';
import type { Actor } from '../common/request-user';
import { asSubject, assertCan, oid, studentFullName, teacherSummary } from '../common/scope';
import { Group, type GroupDocument } from '../groups/group.schema';
import { GroupsService } from '../groups/groups.service';
import { Enrollment } from '../students/enrollment.schema';
import { Student, type StudentDocument } from '../students/student.schema';
import { toPublicUser, User, type UserDocument } from '../users/user.schema';
import { UsersService } from '../users/users.service';
import { GuardianLink } from './guardian-link.schema';

type Person = {
  _id: Types.ObjectId;
  firstName: string;
  lastName?: string;
  email?: string | null;
  username?: string;
  phone?: string | null;
  mustChangePassword?: boolean;
};

export function linkView(
  link: { _id: Types.ObjectId; relationship: GuardianLinkView['relationship'] },
  guardian: Person | undefined,
  linkedAt: Date,
): GuardianLinkView {
  return {
    id: link._id.toString(),
    guardian: guardian
      ? {
          id: guardian._id.toString(),
          name: teacherSummary({ ...guardian, email: guardian.email ?? '' }).name,
          username: guardian.username ?? '',
          phone: guardian.phone ?? null,
          email: guardian.email ?? null,
          activated: !guardian.mustChangePassword,
        }
      : { id: '', name: '', username: '', phone: null, email: null, activated: false },
    relationship: link.relationship,
    linkedAt: linkedAt.toISOString(),
  };
}

/**
 * Guardian accounts (changes requested by the school): the homeroom teacher or the direction
 * creates them from the student, with name, phone, address and relationship. The phone
 * identifies the person across the school: a second child is added to the same account.
 */
@Injectable()
export class GuardianAccountsService {
  constructor(
    @InjectModel(GuardianLink.name) private readonly linkModel: Model<GuardianLink>,
    @InjectModel(Student.name) private readonly studentModel: Model<Student>,
    @InjectModel(Enrollment.name) private readonly enrollmentModel: Model<Enrollment>,
    @InjectModel(Group.name) private readonly groupModel: Model<Group>,
    @InjectModel(User.name) private readonly userModel: Model<User>,
    @InjectConnection() private readonly connection: Connection,
    private readonly groups: GroupsService,
    private readonly users: UsersService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionsService,
    private readonly audit: AuditService,
  ) {}

  /** Student, active enrollment and group; the actor must manage guardians of that group. */
  private async studentInGroup(studentId: string, actor: Actor) {
    const student = await this.studentModel
      .findOne({ _id: oid(studentId), schoolId: oid(actor.user.schoolId), deletedAt: null })
      .exec();
    if (!student) throw Errors.notFound('El alumno no existe.');
    const enrollment = await this.enrollmentModel
      .findOne({ studentId: student._id, status: 'ACTIVE' })
      .sort({ from: -1 })
      .lean()
      .exec();
    if (!enrollment) throw Errors.badRequest('El alumno no está inscrito en ningún grupo.');
    const group = await this.groupModel.findById(enrollment.groupId).exec();
    if (!group) throw Errors.notFound('El grupo no existe.');
    assertCan(actor.ability, 'create', 'GuardianLink', {
      schoolId: group.schoolId,
      groupId: group._id,
    });
    return { student, group };
  }

  /** Children of a guardian with their current group (to confirm the siblings). */
  private async childrenOf(guardianId: Types.ObjectId) {
    const links = await this.linkModel
      .find({ guardianUserId: guardianId, status: 'ACTIVE' })
      .lean()
      .exec();
    const ids = links.map((l) => l.studentId);
    const [students, enrollments] = await Promise.all([
      this.studentModel
        .find({ _id: { $in: ids } })
        .lean()
        .exec(),
      this.enrollmentModel
        .find({ studentId: { $in: ids }, status: 'ACTIVE' })
        .lean()
        .exec(),
    ]);
    const groups = await this.groupModel
      .find({ _id: { $in: enrollments.map((e) => e.groupId) } }, { name: 1 })
      .lean()
      .exec();
    return students.map((s) => {
      const enrollment = enrollments.find((e) => e.studentId.equals(s._id));
      const group = groups.find((g) => enrollment && g._id.equals(enrollment.groupId));
      return { id: s._id.toString(), fullName: studentFullName(s), groupName: group?.name ?? '' };
    });
  }

  /**
   * Creates the guardian account (username TUT26-0001 + temporary password) and links it to the
   * student. With a phone already registered for a guardian of the school, the student is
   * added to that account instead (siblings share one account).
   */
  async createForStudent(
    studentId: string,
    input: CreateGuardianData,
    actor: Actor,
  ): Promise<CreatedAccountView> {
    const { student, group } = await this.studentInGroup(studentId, actor);
    const linked = await this.linkModel.countDocuments({
      studentId: student._id,
      status: 'ACTIVE',
    });
    if (linked >= MAX_GUARDIANS_PER_STUDENT) {
      throw Errors.conflict(
        `Este alumno ya tiene ${MAX_GUARDIANS_PER_STUDENT} tutores vinculados, el máximo permitido.`,
      );
    }
    const existing = await this.userModel
      .findOne({
        schoolId: group.schoolId,
        phone: input.phone,
        roles: Role.GUARDIAN,
        deletedAt: null,
      })
      .exec();
    if (!existing && input.email && (await this.users.findByEmail(input.email))) {
      throw Errors.conflict('Ese correo ya lo usa otra cuenta.');
    }

    let guardian!: UserDocument;
    let password: string | null = null;
    await this.connection.transaction(async (session) => {
      if (existing) {
        guardian = existing;
        const previous = await this.linkModel
          .findOne({ guardianUserId: existing._id, studentId: student._id }, null, { session })
          .exec();
        if (previous?.status === 'ACTIVE') {
          throw Errors.conflict(
            `Este alumno ya está vinculado con ${existing.firstName} ${existing.lastName} (${existing.username}).`,
          );
        }
        if (previous) {
          previous.set({
            status: 'ACTIVE',
            relationship: input.relationship,
            revokedAt: null,
            revokedBy: null,
          });
          await previous.save({ session });
          await this.recordLink(previous._id, existing, student, group, input, actor, session);
          return;
        }
      } else {
        password = temporaryPassword(TEMP_PASSWORD_ALPHABET);
        guardian = await this.users.create(
          {
            schoolId: group.schoolId,
            email: input.email,
            phone: input.phone,
            address: input.address,
            passwordHash: await this.passwords.hash(password),
            firstName: input.firstName,
            lastName: input.lastName,
            roles: [Role.GUARDIAN],
            mustChangePassword: true,
            createdBy: actor.user.id,
          },
          session,
        );
      }
      const [link] = await this.linkModel.create(
        [
          {
            schoolId: group.schoolId,
            guardianUserId: guardian._id,
            studentId: student._id,
            relationship: input.relationship,
          },
        ],
        { session },
      );
      await this.recordLink(link!._id, guardian, student, group, input, actor, session);
    });

    return {
      user: toPublicUser(guardian),
      username: guardian.username ?? '',
      temporaryPassword: password,
      existing: Boolean(existing),
      children: await this.childrenOf(guardian._id),
    };
  }

  private recordLink(
    linkId: Types.ObjectId,
    guardian: UserDocument,
    student: StudentDocument,
    group: GroupDocument,
    input: CreateGuardianData,
    actor: Actor,
    session: Parameters<AuditService['record']>[2],
  ) {
    return this.audit.record(
      actor,
      [
        {
          action: 'create',
          entity: 'guardianLink',
          entityId: linkId,
          groupId: group._id,
          before: null,
          after: {
            studentId: student._id.toString(),
            guardianName: `${guardian.firstName} ${guardian.lastName}`.trim(),
            relationship: RELATIONSHIP_LABELS[input.relationship],
          },
        },
      ],
      session,
    );
  }

  /** "Padres de familia" of a group: each active student with their guardians. */
  async listForGroup(groupId: string, actor: Actor): Promise<GroupGuardianRow[]> {
    const group = await this.groups.load(groupId, actor);
    assertCan(actor.ability, 'read', 'GuardianLink', {
      schoolId: group.schoolId,
      groupId: group._id,
    });
    const enrollments = await this.enrollmentModel
      .find({ groupId: group._id, status: 'ACTIVE' })
      .sort({ listNumber: 1 })
      .lean()
      .exec();
    const studentIds = enrollments.map((e) => e.studentId);
    const [students, links] = await Promise.all([
      this.studentModel
        .find({ _id: { $in: studentIds } })
        .lean()
        .exec(),
      this.linkModel
        .find({ studentId: { $in: studentIds }, status: 'ACTIVE' })
        .lean()
        .exec(),
    ]);
    const guardians = await this.userModel
      .find(
        { _id: { $in: links.map((l) => l.guardianUserId) } },
        { firstName: 1, lastName: 1, email: 1, username: 1, phone: 1, mustChangePassword: 1 },
      )
      .lean<Person[]>()
      .exec();
    const guardianBy = new Map(guardians.map((g) => [g._id.toString(), g]));
    return enrollments.flatMap((e): GroupGuardianRow[] => {
      const s = students.find((x) => x._id.equals(e.studentId));
      if (!s) return [];
      const own = links.filter((l) => l.studentId.equals(s._id));
      return [
        {
          student: {
            id: s._id.toString(),
            listNumber: e.listNumber,
            fullName: studentFullName(s),
            shortName: shortStudentName(s),
          },
          status: own.length ? 'LINKED' : 'NONE',
          links: own.map((l) =>
            linkView(
              l,
              guardianBy.get(l.guardianUserId.toString()),
              (l as unknown as { createdAt: Date }).createdAt,
            ),
          ),
        },
      ];
    });
  }

  /**
   * New temporary password for a guardian (lost or never used): whoever manages guardians of the
   * group of any of their children (homeroom teacher, direction, admin).
   */
  async resetPassword(guardianId: string, actor: Actor): Promise<TemporaryPasswordView> {
    const guardian = await this.userModel
      .findOne({
        _id: oid(guardianId),
        schoolId: oid(actor.user.schoolId),
        roles: Role.GUARDIAN,
        deletedAt: null,
      })
      .exec();
    if (!guardian) throw Errors.notFound('La cuenta no existe.');
    const links = await this.linkModel
      .find({ guardianUserId: guardian._id, status: 'ACTIVE' })
      .lean()
      .exec();
    const enrollments = await this.enrollmentModel
      .find({ studentId: { $in: links.map((l) => l.studentId) }, status: 'ACTIVE' })
      .lean()
      .exec();
    const allowed = enrollments.some((e) =>
      actor.ability.can(
        'create',
        asSubject('GuardianLink', { schoolId: guardian.schoolId, groupId: e.groupId }),
      ),
    );
    // Staff accounts are reset from Usuarios, never from here.
    if (!allowed || guardian.roles.some((r) => r !== Role.GUARDIAN)) throw Errors.forbidden();
    const password = temporaryPassword(TEMP_PASSWORD_ALPHABET);
    await this.users.setPassword(guardian._id, await this.passwords.hash(password), true);
    await this.sessions.revokeAllForUser(guardian._id, 'RESET_BY_ADMIN');
    return { username: guardian.username ?? '', temporaryPassword: password };
  }
}
