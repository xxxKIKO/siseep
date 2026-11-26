import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FIELD_COLORS, FIELD_NAMES, PRIMARY_COLOR } from '@siseep/shared';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import type { Model, Types } from 'mongoose';
import { ActivitiesService } from '../activities/activities.service';
import { Errors } from '../common/app.exception';
import type { Actor } from '../common/request-user';
import { studentFullName, teacherSummary } from '../common/scope';
import { GroupsService } from '../groups/groups.service';
import { School } from '../schools/school.schema';
import { Enrollment } from '../students/enrollment.schema';
import { Student } from '../students/student.schema';
import { User } from '../users/user.schema';
import { PdfService } from './pdf.service';
import { escapeHtml, renderTemplate } from './templates';

const COMPONENT_NAMES: Record<string, string> = {
  DESEMPENO: 'Desempeño escolar',
  PROYECTO: 'Proyectos',
  EXAMEN: 'Exámenes',
  COMPLEMENTARIA: 'Materia complementaria',
};

@Injectable()
export class ReportsService {
  constructor(
    @InjectModel(School.name) private readonly schoolModel: Model<School>,
    @InjectModel(Enrollment.name) private readonly enrollmentModel: Model<Enrollment>,
    @InjectModel(Student.name) private readonly studentModel: Model<Student>,
    @InjectModel(User.name) private readonly userModel: Model<User>,
    private readonly groups: GroupsService,
    private readonly activities: ActivitiesService,
    private readonly pdf: PdfService,
  ) {}

  /**
   * Printable list of the group (N/L, name, wide column to write on) for the paper transition.
   * With an activity, the header shows its field, name and date; without one, blank fields.
   */
  async captureSheet(
    groupId: string,
    activityId: string | undefined,
    actor: Actor,
  ): Promise<{ pdf: Buffer; fileName: string }> {
    const group = await this.groups.load(groupId, actor);
    const activity = activityId ? await this.activities.load(activityId, actor) : null;
    if (activity && !activity.groupId.equals(group._id)) {
      throw Errors.badRequest('La actividad no es de este grupo.');
    }

    const [school, enrollments, teacher] = await Promise.all([
      this.schoolModel.findById(group.schoolId, { name: 1 }).lean().exec(),
      this.enrollmentModel
        .find({ groupId: group._id, status: 'ACTIVE' })
        .sort({ listNumber: 1 })
        .lean()
        .exec(),
      group.homeroomTeacherId
        ? this.userModel
            .findById(group.homeroomTeacherId, { firstName: 1, lastName: 1, email: 1 })
            .lean<{ _id: Types.ObjectId; firstName: string; lastName: string; email: string }>()
            .exec()
        : null,
    ]);
    const students = await this.studentModel
      .find({ _id: { $in: enrollments.map((e) => e.studentId) } })
      .lean()
      .exec();
    const nameBy = new Map(students.map((s) => [s._id.toString(), studentFullName(s)]));
    const rows = enrollments
      .map(
        (e) =>
          `<tr><td class="nl">${e.listNumber}</td><td class="name">${escapeHtml(nameBy.get(e.studentId.toString()) ?? '')}</td><td></td></tr>`,
      )
      .join('\n');

    const blank = '____________________';
    const html = renderTemplate(
      'capture-sheet',
      {
        school: school?.name ?? '',
        group: group.name,
        field: activity ? FIELD_NAMES[activity.fieldKey] : blank,
        activity: activity ? activity.name : blank,
        component: activity ? COMPONENT_NAMES[activity.component]! : blank,
        date: activity ? format(activity.date, "d 'de' MMMM 'de' yyyy", { locale: es }) : blank,
        teacher: teacher ? teacherSummary(teacher).name : '',
        fieldColor: activity ? FIELD_COLORS[activity.fieldKey] : PRIMARY_COLOR,
        rows,
      },
      ['rows'],
    );
    const pdf = await this.pdf.render(html);
    const safe = (s: string) => s.replace(/[\\/:*?"<>|]+/g, '-');
    const fileName = activity
      ? `Hoja de captura ${safe(group.name)} - ${safe(activity.name)}.pdf`
      : `Hoja de captura ${safe(group.name)}.pdf`;
    return { pdf, fileName };
  }
}
