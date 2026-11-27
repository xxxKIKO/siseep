import { Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { type GuardianLinkView, RELATIONSHIP_LABELS } from '@siseep/shared';
import type { Connection, Model } from 'mongoose';
import { AuditService } from '../audit/audit.service';
import { Errors } from '../common/app.exception';
import type { Actor } from '../common/request-user';
import { assertCan, oid } from '../common/scope';
import { Enrollment } from '../students/enrollment.schema';
import { Student } from '../students/student.schema';
import { User } from '../users/user.schema';
import { linkView } from './guardian-accounts.service';
import { GuardianLink } from './guardian-link.schema';

/** Guardians of a student (student file) and unlinking: admin and direction. */
@Injectable()
export class GuardianLinksService {
  constructor(
    @InjectModel(GuardianLink.name) private readonly linkModel: Model<GuardianLink>,
    @InjectModel(Student.name) private readonly studentModel: Model<Student>,
    @InjectModel(Enrollment.name) private readonly enrollmentModel: Model<Enrollment>,
    @InjectModel(User.name) private readonly userModel: Model<User>,
    @InjectConnection() private readonly connection: Connection,
    private readonly audit: AuditService,
  ) {}

  async forStudent(studentId: string, actor: Actor): Promise<GuardianLinkView[]> {
    const student = await this.studentModel
      .findOne({ _id: oid(studentId), schoolId: oid(actor.user.schoolId) })
      .lean()
      .exec();
    if (!student) throw Errors.notFound('El alumno no existe.');
    const enrollment = await this.enrollmentModel
      .findOne({ studentId: student._id, status: 'ACTIVE' })
      .sort({ from: -1 })
      .lean()
      .exec();
    assertCan(actor.ability, 'read', 'GuardianLink', {
      schoolId: student.schoolId,
      groupId: enrollment?.groupId ?? null,
    });
    const links = await this.linkModel
      .find({ studentId: student._id, status: 'ACTIVE' })
      .sort({ createdAt: 1 })
      .lean()
      .exec();
    const users = await this.userModel
      .find(
        { _id: { $in: links.map((l) => l.guardianUserId) } },
        { firstName: 1, lastName: 1, email: 1, username: 1, phone: 1, mustChangePassword: 1 },
      )
      .lean()
      .exec();
    return links.map((l) =>
      linkView(
        l,
        users.find((u) => u._id.equals(l.guardianUserId)),
        (l as unknown as { createdAt: Date }).createdAt,
      ),
    );
  }

  /** Unlinks (the row stays REVOKED for the audit log); the guardian stops seeing the child. */
  async revoke(linkId: string, actor: Actor): Promise<void> {
    const link = await this.linkModel
      .findOne({ _id: oid(linkId), schoolId: oid(actor.user.schoolId) })
      .exec();
    if (!link || link.status !== 'ACTIVE') throw Errors.notFound('El vínculo no existe.');
    const [guardian, enrollment] = await Promise.all([
      this.userModel.findById(link.guardianUserId, { firstName: 1, lastName: 1 }).lean().exec(),
      this.enrollmentModel
        .findOne({ studentId: link.studentId, status: 'ACTIVE' })
        .sort({ from: -1 })
        .lean()
        .exec(),
    ]);
    assertCan(actor.ability, 'delete', 'GuardianLink', {
      schoolId: link.schoolId,
      groupId: enrollment?.groupId ?? null,
    });
    const describe = (status: string) => ({
      studentId: link.studentId.toString(),
      guardianName: guardian ? `${guardian.firstName} ${guardian.lastName ?? ''}`.trim() : '',
      relationship: RELATIONSHIP_LABELS[link.relationship],
      status,
    });
    await this.connection.transaction(async (session) => {
      link.status = 'REVOKED';
      link.revokedAt = new Date();
      link.revokedBy = oid(actor.user.id);
      await link.save({ session });
      await this.audit.record(
        actor,
        [
          {
            action: 'delete',
            entity: 'guardianLink',
            entityId: link._id,
            groupId: enrollment?.groupId ?? null,
            before: describe('ACTIVE'),
            after: describe('REVOKED'),
          },
        ],
        session,
      );
    });
  }
}
