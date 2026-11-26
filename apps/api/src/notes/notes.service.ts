import { Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import {
  type CreateNoteInput,
  dateOnlyToDate,
  dateToDateOnly,
  type NoteView,
  normalizeNoteVisibility,
  shortStudentName,
  type UpdateNoteInput,
} from '@siseep/shared';
import type { Connection, Model, Types } from 'mongoose';
import { AuditService } from '../audit/audit.service';
import { Errors } from '../common/app.exception';
import type { Actor } from '../common/request-user';
import { asSubject, assertCan, oid, scopedQuery, teacherSummary } from '../common/scope';
import { Group } from '../groups/group.schema';
import { GroupsService } from '../groups/groups.service';
import { Period } from '../periods/period.schema';
import { Enrollment } from '../students/enrollment.schema';
import { Student } from '../students/student.schema';
import { User } from '../users/user.schema';
import { StudentNote, type StudentNoteDocument } from './student-note.schema';

type Person = { _id: Types.ObjectId; firstName: string; lastName?: string; email: string };

/** Snapshot stored in the audit log (no ids of other people, no names). */
const snapshot = (n: StudentNoteDocument) => ({
  kind: n.kind,
  text: n.text,
  fieldKey: n.fieldKey ?? null,
  date: dateToDateOnly(n.date),
  visibleToGuardians: n.visibleToGuardians,
});

@Injectable()
export class NotesService {
  constructor(
    @InjectModel(StudentNote.name) private readonly noteModel: Model<StudentNote>,
    @InjectModel(Student.name) private readonly studentModel: Model<Student>,
    @InjectModel(Enrollment.name) private readonly enrollmentModel: Model<Enrollment>,
    @InjectModel(Group.name) private readonly groupModel: Model<Group>,
    @InjectModel(Period.name) private readonly periodModel: Model<Period>,
    @InjectModel(User.name) private readonly userModel: Model<User>,
    @InjectConnection() private readonly connection: Connection,
    private readonly groups: GroupsService,
    private readonly audit: AuditService,
  ) {}

  // ---- reads -----------------------------------------------------------------
  /** Notes of a group on one day ("Notas de hoy"). */
  async listForGroup(groupId: string, date: string, actor: Actor): Promise<NoteView[]> {
    const group = await this.groups.load(groupId, actor);
    const scope = scopedQuery(actor, 'StudentNote');
    if (!scope) throw Errors.forbidden();
    const notes = await this.noteModel
      .find({ $and: [scope, { groupId: group._id, date: dateOnlyToDate(date), deletedAt: null }] })
      .sort({ createdAt: -1 })
      .exec();
    return this.toViews(notes, actor);
  }

  /** Notes of a student (optionally one period), within the actor's scope. */
  async listForStudent(
    studentId: string,
    periodId: string | undefined,
    actor: Actor,
  ): Promise<NoteView[]> {
    const { enrollment } = await this.resolveStudent(studentId, actor);
    await this.groups.load(enrollment.groupId.toString(), actor);
    const scope = scopedQuery(actor, 'StudentNote');
    if (!scope) throw Errors.forbidden();
    const notes = await this.noteModel
      .find({
        $and: [
          scope,
          {
            studentId: oid(studentId),
            deletedAt: null,
            ...(periodId ? { periodId: oid(periodId) } : {}),
          },
        ],
      })
      .sort({ date: -1, createdAt: -1 })
      .exec();
    return this.toViews(notes, actor);
  }

  // ---- writes ------------------------------------------------------------------
  async create(studentId: string, input: CreateNoteInput, actor: Actor): Promise<NoteView> {
    const { student, enrollment, group } = await this.resolveStudent(studentId, actor);
    assertCan(actor.ability, 'create', 'StudentNote', {
      schoolId: group.schoolId,
      groupId: group._id,
      authorId: actor.user.id,
    });
    const period = await this.periodFor(group.schoolYearId, input.date);

    let note!: StudentNoteDocument;
    await this.connection.transaction(async (session) => {
      const [created] = await this.noteModel.create(
        [
          {
            schoolId: group.schoolId,
            studentId: student._id,
            groupId: enrollment.groupId,
            periodId: period._id,
            authorId: actor.user.id,
            date: dateOnlyToDate(input.date),
            fieldKey: input.fieldKey ?? null,
            kind: input.kind,
            text: input.text,
            visibleToGuardians: normalizeNoteVisibility(input.kind, input.visibleToGuardians),
          },
        ],
        { session },
      );
      note = created!;
      await this.audit.record(
        actor,
        [
          {
            action: 'create',
            entity: 'note',
            entityId: note._id,
            groupId: note.groupId,
            after: snapshot(note),
          },
        ],
        session,
      );
    });
    const [view] = await this.toViews([note], actor);
    return view!;
  }

  async update(id: string, input: UpdateNoteInput, actor: Actor): Promise<NoteView> {
    const note = await this.load(id, actor);
    assertCan(actor.ability, 'update', 'StudentNote', note);
    const before = snapshot(note);
    if (input.date) {
      const group = await this.groupModel.findById(note.groupId).lean().exec();
      const period = await this.periodFor(group!.schoolYearId, input.date);
      note.date = dateOnlyToDate(input.date);
      note.periodId = period._id;
    } else {
      await this.assertPeriodEditable(note.periodId);
    }
    if (input.kind) note.kind = input.kind;
    if (input.text) note.text = input.text;
    if (input.fieldKey !== undefined) note.fieldKey = input.fieldKey;
    note.visibleToGuardians = normalizeNoteVisibility(
      note.kind,
      input.visibleToGuardians ?? note.visibleToGuardians,
    );

    await this.connection.transaction(async (session) => {
      await note.save({ session });
      await this.audit.record(
        actor,
        [
          {
            action: 'update',
            entity: 'note',
            entityId: note._id,
            groupId: note.groupId,
            before,
            after: snapshot(note),
          },
        ],
        session,
      );
    });
    const [view] = await this.toViews([note], actor);
    return view!;
  }

  async remove(id: string, actor: Actor): Promise<void> {
    const note = await this.load(id, actor);
    assertCan(actor.ability, 'delete', 'StudentNote', note);
    await this.assertPeriodEditable(note.periodId);
    await this.connection.transaction(async (session) => {
      note.deletedAt = new Date();
      await note.save({ session });
      await this.audit.record(
        actor,
        [
          {
            action: 'delete',
            entity: 'note',
            entityId: note._id,
            groupId: note.groupId,
            before: snapshot(note),
          },
        ],
        session,
      );
    });
  }

  // ---- helpers -----------------------------------------------------------------
  private async load(id: string, actor: Actor): Promise<StudentNoteDocument> {
    const note = await this.noteModel
      .findOne({ _id: id, schoolId: actor.user.schoolId, deletedAt: null })
      .exec();
    if (!note) throw Errors.notFound('La nota no existe.');
    assertCan(actor.ability, 'read', 'StudentNote', note);
    return note;
  }

  /** The student and their active enrollment (current school year first). */
  private async resolveStudent(studentId: string, actor: Actor) {
    const student = await this.studentModel
      .findOne({ _id: studentId, schoolId: actor.user.schoolId, deletedAt: null })
      .exec();
    if (!student) throw Errors.notFound('El alumno no existe.');
    const enrollment = await this.enrollmentModel
      .findOne({ studentId: student._id, status: 'ACTIVE' })
      .sort({ createdAt: -1 })
      .exec();
    if (!enrollment) throw Errors.badRequest('El alumno no está inscrito en ningún grupo.');
    const group = await this.groupModel.findById(enrollment.groupId).exec();
    if (!group) throw Errors.notFound('El grupo no existe.');
    return { student, enrollment, group };
  }

  /** The period of the school year that contains the date; it must not be closed. */
  private async periodFor(schoolYearId: Types.ObjectId, date: string) {
    const day = dateOnlyToDate(date);
    const period = await this.periodModel
      .findOne({ schoolYearId, startDate: { $lte: day }, endDate: { $gte: day } })
      .exec();
    if (!period)
      throw Errors.badRequest('La fecha no cae dentro de ningún periodo del ciclo escolar.');
    if (period.status === 'CLOSED' || period.status === 'PUBLISHED') throw Errors.periodNotOpen();
    return period;
  }

  private async assertPeriodEditable(periodId: Types.ObjectId): Promise<void> {
    const period = await this.periodModel.findById(periodId, { status: 1 }).lean().exec();
    if (period && (period.status === 'CLOSED' || period.status === 'PUBLISHED')) {
      throw Errors.periodNotOpen();
    }
  }

  private async toViews(notes: StudentNoteDocument[], actor: Actor): Promise<NoteView[]> {
    if (notes.length === 0) return [];
    const studentIds = [...new Set(notes.map((n) => n.studentId.toString()))].map(oid);
    const [students, enrollments, authors] = await Promise.all([
      this.studentModel
        .find({ _id: { $in: studentIds } })
        .lean()
        .exec(),
      this.enrollmentModel
        .find({ studentId: { $in: studentIds }, groupId: { $in: notes.map((n) => n.groupId) } })
        .lean()
        .exec(),
      this.userModel
        .find(
          { _id: { $in: notes.map((n) => n.authorId) } },
          { firstName: 1, lastName: 1, email: 1 },
        )
        .lean<Person[]>()
        .exec(),
    ]);
    const studentBy = new Map(students.map((s) => [s._id.toString(), s]));
    const authorBy = new Map(authors.map((a) => [a._id.toString(), a]));
    return notes.map((n) => {
      const s = studentBy.get(n.studentId.toString());
      const author = authorBy.get(n.authorId.toString());
      const listNumber = enrollments.find(
        (e) => e.studentId.equals(n.studentId) && e.groupId.equals(n.groupId),
      )?.listNumber;
      return {
        id: n._id.toString(),
        student: {
          id: n.studentId.toString(),
          shortName: s ? shortStudentName(s) : '',
          ...(listNumber ? { listNumber } : {}),
        },
        groupId: n.groupId.toString(),
        periodId: n.periodId.toString(),
        author: author
          ? { id: author._id.toString(), name: teacherSummary(author).name }
          : { id: n.authorId.toString(), name: '' },
        date: dateToDateOnly(n.date),
        ...(n.fieldKey ? { fieldKey: n.fieldKey } : {}),
        kind: n.kind,
        text: n.text,
        visibleToGuardians: n.visibleToGuardians,
        canEdit: actor.ability.can('update', asSubject('StudentNote', n)),
        createdAt: (n as unknown as { createdAt: Date }).createdAt.toISOString(),
      };
    });
  }
}
