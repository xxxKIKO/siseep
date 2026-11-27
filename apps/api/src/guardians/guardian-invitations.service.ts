import { randomInt } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import {
  formatGuardianCode,
  GUARDIAN_CODE_ALPHABET,
  GUARDIAN_CODE_LENGTH,
  GUARDIAN_CODE_TTL_DAYS,
  type GroupGuardianRow,
  type GuardianCodePreview,
  type GuardianInvitationView,
  InvitationType,
  MAX_GUARDIANS_PER_STUDENT,
  maskedStudentName,
  type Relationship,
  RELATIONSHIP_LABELS,
  Role,
  shortStudentName,
} from '@siseep/shared';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import type { ClientSession, Connection, Model, Types } from 'mongoose';
import { AuditService } from '../audit/audit.service';
import { Errors } from '../common/app.exception';
import { sha256 } from '../common/crypto';
import type { Actor } from '../common/request-user';
import { assertCan, oid, studentFullName, teacherSummary } from '../common/scope';
import { AppConfigService } from '../config/app-config.service';
import { Group, type GroupDocument } from '../groups/group.schema';
import { GroupsService } from '../groups/groups.service';
import { Invitation, type InvitationDocument } from '../invitations/invitation.schema';
import { PdfService } from '../reports/pdf.service';
import { escapeHtml, renderTemplate } from '../reports/templates';
import { School } from '../schools/school.schema';
import { Enrollment } from '../students/enrollment.schema';
import { Student, type StudentDocument } from '../students/student.schema';
import { User, type UserDocument } from '../users/user.schema';
import { GuardianLink } from './guardian-link.schema';

const DAY_MS = 24 * 60 * 60 * 1000;

/** 8 characters from the unambiguous alphabet (no 0/O/1/I), cryptographically random. */
export function generateGuardianCode(): string {
  let code = '';
  for (let i = 0; i < GUARDIAN_CODE_LENGTH; i++) {
    code += GUARDIAN_CODE_ALPHABET[randomInt(GUARDIAN_CODE_ALPHABET.length)];
  }
  return code;
}

type Person = { _id: Types.ObjectId; firstName: string; lastName?: string; email: string };

/**
 * Guardian codes (stage 5): the homeroom teacher or the admin generates a single-use code per
 * student; only its SHA-256 is stored. Redeeming it creates the guardianLink.
 */
@Injectable()
export class GuardianInvitationsService {
  constructor(
    @InjectModel(Invitation.name) private readonly invitationModel: Model<Invitation>,
    @InjectModel(GuardianLink.name) private readonly linkModel: Model<GuardianLink>,
    @InjectModel(Student.name) private readonly studentModel: Model<Student>,
    @InjectModel(Enrollment.name) private readonly enrollmentModel: Model<Enrollment>,
    @InjectModel(Group.name) private readonly groupModel: Model<Group>,
    @InjectModel(School.name) private readonly schoolModel: Model<School>,
    @InjectModel(User.name) private readonly userModel: Model<User>,
    @InjectConnection() private readonly connection: Connection,
    private readonly groups: GroupsService,
    private readonly audit: AuditService,
    private readonly pdf: PdfService,
    private readonly config: AppConfigService,
  ) {}

  signUpUrl(code?: string): string {
    const base = `${this.config.get('WEB_URL')}/registro`;
    return code ? `${base}?codigo=${code}` : base;
  }

  // ---- generating codes -------------------------------------------------------------
  async create(
    studentId: string,
    relationship: Relationship | undefined,
    actor: Actor,
  ): Promise<GuardianInvitationView> {
    const { student, group } = await this.studentInGroup(studentId, actor);
    return this.issue(student, group, relationship, actor);
  }

  private async issue(
    student: StudentDocument,
    group: GroupDocument,
    relationship: Relationship | undefined,
    actor: Actor,
  ): Promise<GuardianInvitationView> {
    const linked = await this.linkModel.countDocuments({
      studentId: student._id,
      status: 'ACTIVE',
    });
    if (linked >= MAX_GUARDIANS_PER_STUDENT) {
      throw Errors.conflict(
        `Este alumno ya tiene ${MAX_GUARDIANS_PER_STUDENT} tutores vinculados, el máximo permitido.`,
      );
    }
    const expiresAt = new Date(Date.now() + GUARDIAN_CODE_TTL_DAYS * DAY_MS);
    for (let attempt = 0; ; attempt++) {
      const code = generateGuardianCode();
      try {
        const invitation = await this.invitationModel.create({
          schoolId: group.schoolId,
          type: InvitationType.GUARDIAN,
          codeHash: sha256(code),
          studentId: student._id,
          groupId: group._id,
          ...(relationship ? { relationship } : {}),
          roles: [Role.GUARDIAN],
          expiresAt,
          createdBy: oid(actor.user.id),
        });
        return {
          id: invitation._id.toString(),
          code,
          expiresAt: expiresAt.toISOString(),
          student: {
            id: student._id.toString(),
            fullName: studentFullName(student),
            shortName: shortStudentName(student),
          },
          groupName: group.name,
          url: this.signUpUrl(code),
        };
      } catch (error) {
        // 32^8 codes: a collision is very unlikely, but the unique index catches it.
        if ((error as { code?: number }).code === 11000 && attempt < 3) continue;
        throw error;
      }
    }
  }

  /** Student, active enrollment and group; the actor must be able to invite for the group. */
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
    assertCan(actor.ability, 'create', 'Invitation', {
      schoolId: group.schoolId,
      groupId: group._id,
      type: 'GUARDIAN',
    });
    return { student, group };
  }

  /** "Padres de familia": linked, pending (code not used yet) or without code, per student. */
  async listForGroup(groupId: string, actor: Actor): Promise<GroupGuardianRow[]> {
    const group = await this.groups.load(groupId, actor);
    assertCan(actor.ability, 'read', 'Invitation', {
      schoolId: group.schoolId,
      groupId: group._id,
      type: 'GUARDIAN',
    });
    const enrollments = await this.enrollmentModel
      .find({ groupId: group._id, status: 'ACTIVE' })
      .sort({ listNumber: 1 })
      .lean()
      .exec();
    const studentIds = enrollments.map((e) => e.studentId);
    const [students, links, pending] = await Promise.all([
      this.studentModel
        .find({ _id: { $in: studentIds } })
        .lean()
        .exec(),
      this.linkModel
        .find({ studentId: { $in: studentIds }, status: 'ACTIVE' })
        .lean()
        .exec(),
      this.invitationModel
        .find({
          type: InvitationType.GUARDIAN,
          studentId: { $in: studentIds },
          usedAt: null,
          expiresAt: { $gt: new Date() },
        })
        .lean()
        .exec(),
    ]);
    const guardians = await this.userModel
      .find(
        { _id: { $in: links.map((l) => l.guardianUserId) } },
        { firstName: 1, lastName: 1, email: 1 },
      )
      .lean<Person[]>()
      .exec();
    const studentBy = new Map(students.map((s) => [s._id.toString(), s]));
    const guardianBy = new Map(guardians.map((g) => [g._id.toString(), g]));

    return enrollments.flatMap((e): GroupGuardianRow[] => {
      const s = studentBy.get(e.studentId.toString());
      if (!s) return [];
      const own = links.filter((l) => l.studentId.equals(s._id));
      const codes = pending.filter((p) => p.studentId?.equals(s._id));
      return [
        {
          student: {
            id: s._id.toString(),
            listNumber: e.listNumber,
            fullName: studentFullName(s),
            shortName: shortStudentName(s),
          },
          status: own.length ? 'LINKED' : codes.length ? 'PENDING' : 'NONE',
          links: own.map((l) => {
            const g = guardianBy.get(l.guardianUserId.toString());
            return {
              id: l._id.toString(),
              guardian: g
                ? { id: g._id.toString(), name: teacherSummary(g).name, email: g.email }
                : { id: l.guardianUserId.toString(), name: '', email: '' },
              relationship: l.relationship,
              linkedAt: (l as unknown as { createdAt: Date }).createdAt.toISOString(),
            };
          }),
          pendingCodes: codes.length,
          pendingExpiresAt: codes.length
            ? new Date(Math.max(...codes.map((c) => c.expiresAt.getTime()))).toISOString()
            : null,
        },
      ];
    });
  }

  /**
   * Printable strips to cut (one per student): name, code, URL and 3 steps. Generates a new code
   * for each student (codes are never stored in plain text, so they cannot be printed later).
   */
  async printStrips(
    groupId: string,
    studentIds: string[] | undefined,
    actor: Actor,
  ): Promise<{ pdf: Buffer; fileName: string; count: number }> {
    const rows = await this.listForGroup(groupId, actor);
    const group = (await this.groupModel.findById(groupId).exec())!;
    assertCan(actor.ability, 'create', 'Invitation', {
      schoolId: group.schoolId,
      groupId: group._id,
      type: 'GUARDIAN',
    });
    const targets = studentIds?.length
      ? rows.filter((r) => studentIds.includes(r.student.id))
      : rows.filter((r) => r.status !== 'LINKED');
    const eligible = targets.filter((r) => r.links.length < MAX_GUARDIANS_PER_STUDENT);
    if (eligible.length === 0) {
      throw Errors.badRequest('No hay alumnos para imprimir códigos.');
    }
    const school = await this.schoolModel.findById(group.schoolId, { name: 1 }).lean().exec();
    const url = this.signUpUrl();
    const strips: string[] = [];
    for (const row of eligible) {
      const student = (await this.studentModel.findById(row.student.id).exec())!;
      const invitation = await this.issue(student, group, undefined, actor);
      const expires = format(new Date(invitation.expiresAt), "d 'de' MMMM", { locale: es });
      strips.push(`<section class="strip">
  <div class="who"><span class="nl">${row.student.listNumber}</span><b>${escapeHtml(row.student.fullName)}</b> · ${escapeHtml(group.name)}</div>
  <div class="code">${escapeHtml(formatGuardianCode(invitation.code))}</div>
  <ol>
    <li>Entra desde tu celular a <b>${escapeHtml(url)}</b></li>
    <li>Escribe el código y confirma el nombre de tu hijo(a).</li>
    <li>Crea tu cuenta o inicia sesión. El código sirve una vez y vence el ${escapeHtml(expires)}.</li>
  </ol>
</section>`);
    }
    const html = renderTemplate(
      'guardian-codes',
      { school: school?.name ?? '', group: group.name, strips: strips.join('\n') },
      ['strips'],
    );
    return {
      pdf: await this.pdf.render(html),
      fileName: `Códigos para padres ${group.name.replace(/[\\/:*?"<>|]+/g, '-')}.pdf`,
      count: eligible.length,
    };
  }

  // ---- redeeming -------------------------------------------------------------------
  /** A usable GUARDIAN invitation (not used, not expired) or 400 INVALID_INVITATION. */
  async findUsable(code: string, session?: ClientSession): Promise<InvitationDocument> {
    const invitation = await this.invitationModel
      .findOne(
        {
          codeHash: sha256(code),
          type: InvitationType.GUARDIAN,
          usedAt: null,
          expiresAt: { $gt: new Date() },
        },
        null,
        { session },
      )
      .exec();
    if (!invitation?.studentId) {
      throw Errors.badRequest(
        'El código no es válido, ya se usó o ya venció. Pide uno nuevo a la maestra.',
      );
    }
    return invitation;
  }

  /** "Vas a vincularte con: Aguilar C. Edgar M., 5°B" (before creating anything). */
  async preview(code: string): Promise<GuardianCodePreview> {
    const invitation = await this.findUsable(code);
    const [student, group, school] = await Promise.all([
      this.studentModel.findById(invitation.studentId).lean().exec(),
      this.groupModel.findById(invitation.groupId).lean().exec(),
      this.schoolModel.findById(invitation.schoolId, { name: 1 }).lean().exec(),
    ]);
    if (!student) throw Errors.badRequest('El código no es válido. Pide uno nuevo a la maestra.');
    return {
      studentName: maskedStudentName(student),
      groupName: group?.name ?? '',
      schoolName: school?.name ?? '',
      expiresAt: invitation.expiresAt.toISOString(),
    };
  }

  /**
   * Links the user with the code's student, in one transaction: the code is consumed exactly once,
   * at most 4 active guardians, the GUARDIAN role is added and the privacy acceptance stored.
   */
  async redeem(
    user: UserDocument,
    code: string,
    relationship: Relationship,
    options: { acceptPrivacy?: boolean; ip?: string },
  ): Promise<{ studentId: string }> {
    const school = await this.schoolModel
      .findById(user.schoolId, { privacyNoticeVersion: 1 })
      .lean()
      .exec();
    const version = school?.privacyNoticeVersion ?? 1;
    if (!options.acceptPrivacy && (user.privacyAcceptedVersion ?? 0) < version) {
      throw Errors.badRequest('Para continuar acepta el aviso de privacidad.');
    }

    let studentId!: Types.ObjectId;
    await this.connection.transaction(async (session) => {
      const invitation = await this.findUsable(code, session);
      if (!invitation.schoolId.equals(user.schoolId)) {
        throw Errors.badRequest('El código no es válido. Pide uno nuevo a la maestra.');
      }
      studentId = invitation.studentId!;
      const active = await this.linkModel.countDocuments(
        { studentId, status: 'ACTIVE' },
        { session },
      );
      const existing = await this.linkModel
        .findOne({ guardianUserId: user._id, studentId }, null, { session })
        .exec();
      if (existing?.status === 'ACTIVE') {
        throw Errors.conflict('Ya estás vinculado con este alumno.');
      }
      if (active >= MAX_GUARDIANS_PER_STUDENT) {
        throw Errors.conflict(
          `Este alumno ya tiene ${MAX_GUARDIANS_PER_STUDENT} tutores vinculados, el máximo permitido.`,
        );
      }
      const used = await this.invitationModel.updateOne(
        { _id: invitation._id, usedAt: null },
        { $set: { usedAt: new Date(), usedBy: user._id } },
        { session },
      );
      if (used.modifiedCount !== 1) {
        throw Errors.badRequest('El código ya se usó. Pide uno nuevo a la maestra.');
      }
      let link;
      if (existing) {
        existing.set({
          status: 'ACTIVE',
          relationship,
          inviteId: invitation._id,
          revokedAt: null,
          revokedBy: null,
        });
        link = await existing.save({ session });
      } else {
        [link] = await this.linkModel.create(
          [
            {
              schoolId: invitation.schoolId,
              guardianUserId: user._id,
              studentId,
              relationship,
              inviteId: invitation._id,
            },
          ],
          { session },
        );
      }
      await this.userModel.updateOne(
        { _id: user._id },
        {
          $addToSet: { roles: Role.GUARDIAN },
          ...(options.acceptPrivacy
            ? { $set: { privacyAcceptedVersion: version, privacyAcceptedAt: new Date() } }
            : {}),
        },
        { session },
      );
      await this.audit.record(
        {
          user: { id: user._id.toString(), schoolId: user.schoolId.toString() },
          ip: options.ip,
        } as unknown as Actor,
        [
          {
            action: 'create',
            entity: 'guardianLink',
            entityId: link!._id,
            groupId: invitation.groupId ?? null,
            before: null,
            after: {
              studentId: studentId.toString(),
              guardianName: `${user.firstName} ${user.lastName}`.trim(),
              relationship: RELATIONSHIP_LABELS[relationship],
            },
          },
        ],
        session,
      );
    });
    return { studentId: studentId.toString() };
  }

  /** Current privacy notice version of a school (stored on the user when accepting). */
  async privacyVersion(schoolId: Types.ObjectId | string): Promise<number> {
    const school = await this.schoolModel
      .findById(schoolId, { privacyNoticeVersion: 1 })
      .lean()
      .exec();
    return school?.privacyNoticeVersion ?? 1;
  }

  async schoolOf(code: string): Promise<Types.ObjectId> {
    return (await this.findUsable(code)).schoolId as Types.ObjectId;
  }
}
