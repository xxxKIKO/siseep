import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  FIELD_NAMES,
  type FieldKey,
  type PeriodResultRow,
  PRIMARY_COLOR,
  roundTo,
} from '@siseep/shared';
import Handlebars from 'handlebars';
import type { Model, Types } from 'mongoose';
import { PeriodResultsService } from '../closing/period-results.service';
import { Errors } from '../common/app.exception';
import type { Actor } from '../common/request-user';
import { oid } from '../common/scope';
import { FilesService } from '../files/files.service';
import { PeriodStatusService } from '../periods/period-status.service';
import { Period, type PeriodDocument } from '../periods/period.schema';
import type { GroupDocument } from '../groups/group.schema';
import { SchoolYear } from '../school-years/school-year.schema';
import { School } from '../schools/school.schema';
import { Enrollment } from '../students/enrollment.schema';
import { PeriodDataService } from '../summary/period-data.service';
import { User } from '../users/user.schema';
import { PdfService } from './pdf.service';
import { buildReportCardsDocx } from './report-card.docx';
import { dataUri, type ReportCard, type ReportCardData } from './report-card.data';

const DASH = '—';
const one = (value: number | null | undefined) =>
  value === null || value === undefined ? DASH : roundTo(value, 1).toFixed(1);

let compiled: Handlebars.TemplateDelegate | null = null;
function template(): Handlebars.TemplateDelegate {
  compiled ??= Handlebars.compile(
    readFileSync(join(__dirname, 'templates', 'report-card.html'), 'utf8'),
    { strict: false },
  );
  return compiled;
}

const safe = (s: string) => s.replace(/[\\/:*?"<>|]+/g, '-');

export interface ReportFile {
  buffer: Buffer;
  fileName: string;
}

/**
 * Report cards (stage 4): one Handlebars template for the PDF and the preview, and the same
 * data rendered with `docx` for Word. Values come from the closing snapshot when the period is
 * CLOSED/PUBLISHED, and from the live calculation (marked BORRADOR) before that.
 */
@Injectable()
export class ReportCardsService {
  constructor(
    @InjectModel(School.name) private readonly schoolModel: Model<School>,
    @InjectModel(SchoolYear.name) private readonly yearModel: Model<SchoolYear>,
    @InjectModel(User.name) private readonly userModel: Model<User>,
    @InjectModel(Period.name) private readonly periodModel: Model<Period>,
    @InjectModel(Enrollment.name) private readonly enrollmentModel: Model<Enrollment>,
    private readonly results: PeriodResultsService,
    private readonly periodData: PeriodDataService,
    private readonly periodStatus: PeriodStatusService,
    private readonly files: FilesService,
    private readonly pdf: PdfService,
  ) {}

  async data(
    groupId: string,
    periodId: string,
    actor: Actor,
    studentId?: string,
  ): Promise<ReportCardData> {
    const { group, period } = await this.results.loadTarget(groupId, periodId, actor);
    return this.build(group, period, studentId);
  }

  /**
   * Report card data without access checks: callers must have checked them (staff via
   * `data`, guardians via their active link and a PUBLISHED period).
   */
  async build(
    group: GroupDocument,
    period: PeriodDocument,
    studentId?: string,
  ): Promise<ReportCardData> {
    const [status, data, school, year, teacher] = await Promise.all([
      this.periodStatus.effective(period._id, group._id),
      this.periodData.load(group, period._id),
      this.schoolModel.findById(group.schoolId).lean().exec(),
      this.yearModel.findById(group.schoolYearId, { name: 1 }).lean().exec(),
      group.homeroomTeacherId
        ? this.userModel
            .findById(group.homeroomTeacherId, { firstName: 1, lastName: 1, logoFileId: 1 })
            .lean()
            .exec()
        : null,
    ]);
    let rows = this.results.rows(data, status);
    if (studentId) {
      rows = rows.filter((r) => r.student.id === studentId);
      if (rows.length === 0) throw Errors.notFound('El alumno no está activo en el grupo.');
    }
    const [schoolLogo, teacherLogo] = await Promise.all([
      this.files.read(school?.logoFileId ?? null),
      this.files.read(teacher?.logoFileId ?? null),
    ]);
    const fields = [...data.scheme.fields].sort((a, b) => a.order - b.order);
    const place = [school?.city, school?.state].filter(Boolean).join(', ');
    const placeDate = [place, period.deliveryDateText].filter(Boolean).join(' · ');

    const toCard = (row: PeriodResultRow): ReportCard => {
      const cardFields = fields.map((def) => {
        const f = row.fields.find((x) => x.fieldKey === def.key);
        return {
          name: def.name || FIELD_NAMES[def.key as FieldKey],
          color: def.color,
          desempeno: one(f?.components.DESEMPENO.value),
          proyecto: one(f?.components.PROYECTO.value),
          examen: one(f?.components.EXAMEN.value),
          base: one(f?.base),
          complementary: f?.complementary ? one(f.complementary.value) : DASH,
          calculated: one(f?.calculated),
          final: f?.final === null || f?.final === undefined ? DASH : String(f.final),
          adjusted: Boolean(f?.adjusted),
        };
      });
      const observations = fields.flatMap((def) => {
        const text = row.observations.byField[def.key as FieldKey];
        return text ? [{ label: def.name || FIELD_NAMES[def.key as FieldKey], text }] : [];
      });
      if (row.observations.general) {
        observations.push({ label: 'Observación general', text: row.observations.general });
      }
      return {
        name: row.student.fullName,
        listNumber: row.student.listNumber,
        fields: cardFields,
        anyAdjusted: cardFields.some((f) => f.adjusted),
        generalAverage: one(row.generalAverage),
        observations,
        legend: row.legendOverride ?? row.legendSuggested,
      };
    };

    return {
      draft: status !== 'CLOSED' && status !== 'PUBLISHED',
      schoolName: school?.name ?? '',
      schoolLogo,
      teacherLogo,
      periodName: period.name,
      schoolYear: year?.name ?? '',
      groupName: group.name,
      teacherName: teacher ? `${teacher.firstName} ${teacher.lastName ?? ''}`.trim() : '',
      placeDate,
      cards: rows.map(toCard),
    };
  }

  /** The report cards as HTML: `screen` adds page shadows for the preview modal. */
  html(data: ReportCardData, mode: 'print' | 'screen' = 'print'): string {
    return template()({
      ...data,
      title: `Boletas ${data.groupName} - ${data.periodName}`,
      primary: PRIMARY_COLOR,
      bodyClass: mode,
      schoolLogo: dataUri(data.schoolLogo),
      teacherLogo: dataUri(data.teacherLogo),
    });
  }

  async groupPdf(groupId: string, periodId: string, actor: Actor): Promise<ReportFile> {
    const data = await this.data(groupId, periodId, actor);
    return {
      buffer: await this.pdf.render(this.html(data)),
      fileName: `Boletas ${safe(data.groupName)} - ${safe(data.periodName)}.pdf`,
    };
  }

  async groupDocx(groupId: string, periodId: string, actor: Actor): Promise<ReportFile> {
    const data = await this.data(groupId, periodId, actor);
    return {
      buffer: await buildReportCardsDocx(data),
      fileName: `Boletas ${safe(data.groupName)} - ${safe(data.periodName)}.docx`,
    };
  }

  /** One student's report card as PDF from already-built data. */
  async renderPdf(data: ReportCardData): Promise<ReportFile> {
    return {
      buffer: await this.pdf.render(this.html(data)),
      fileName: `Boleta ${safe(data.cards[0]?.name ?? '')} - ${safe(data.periodName)}.pdf`,
    };
  }

  async studentPdf(studentId: string, periodId: string, actor: Actor): Promise<ReportFile> {
    const groupId = await this.groupOfStudent(studentId, periodId, actor);
    const data = await this.data(groupId.toString(), periodId, actor, studentId);
    return {
      buffer: await this.pdf.render(this.html(data)),
      fileName: `Boleta ${safe(data.cards[0]!.name)} - ${safe(data.periodName)}.pdf`,
    };
  }

  /** The group the student is (actively) enrolled in during the period's school year. */
  private async groupOfStudent(
    studentId: string,
    periodId: string,
    actor: Actor,
  ): Promise<Types.ObjectId> {
    const period = await this.periodModel
      .findOne({ _id: oid(periodId), schoolId: oid(actor.user.schoolId) }, { schoolYearId: 1 })
      .lean()
      .exec();
    if (!period) throw Errors.notFound('El periodo no existe.');
    const enrollment = await this.enrollmentModel
      .findOne({
        studentId: oid(studentId),
        schoolYearId: period.schoolYearId,
        schoolId: oid(actor.user.schoolId),
        status: 'ACTIVE',
      })
      .lean()
      .exec();
    if (!enrollment) throw Errors.notFound('El alumno no está inscrito en ese ciclo.');
    return enrollment.groupId;
  }
}
