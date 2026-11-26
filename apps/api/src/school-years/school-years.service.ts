import { Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import {
  type CreatePeriodInput,
  type CreateSchoolYearInput,
  dateOnlyToDate,
  dateToDateOnly,
  DEFAULT_GRADING_SCHEME,
  type GradingScheme as GradingSchemeData,
  type PeriodView,
  type SchoolYearView,
  type UpdatePeriodInput,
  type UpdateSchoolYearInput,
} from '@siseep/shared';
import type { Connection, Model } from 'mongoose';
import { Errors } from '../common/app.exception';
import type { Actor } from '../common/request-user';
import { assertCan, oid, requireScopedQuery } from '../common/scope';
import { GradingScheme } from '../grading-schemes/grading-scheme.schema';
import { Period, type PeriodDocument } from '../periods/period.schema';
import { SchoolYear, type SchoolYearDocument } from './school-year.schema';

/** School years, their periods and grading scheme (admin writes; staff reads). */
@Injectable()
export class SchoolYearsService {
  constructor(
    @InjectModel(SchoolYear.name) private readonly yearModel: Model<SchoolYear>,
    @InjectModel(Period.name) private readonly periodModel: Model<Period>,
    @InjectModel(GradingScheme.name) private readonly schemeModel: Model<GradingScheme>,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  // ---- School years --------------------------------------------------------
  async list(actor: Actor): Promise<SchoolYearView[]> {
    const years = await this.yearModel
      .find(requireScopedQuery(actor, 'SchoolYear'))
      .sort({ startDate: -1 })
      .exec();
    return years.map(toYearView);
  }

  private async loadYear(id: string, actor: Actor): Promise<SchoolYearDocument> {
    const year = await this.yearModel.findOne({ _id: id, schoolId: actor.user.schoolId }).exec();
    if (!year) throw Errors.notFound('El ciclo escolar no existe.');
    assertCan(actor.ability, 'read', 'SchoolYear', year);
    return year;
  }

  /** Creates the school year with the default grading scheme of section 5. */
  async create(input: CreateSchoolYearInput, actor: Actor): Promise<SchoolYearView> {
    const schoolId = actor.user.schoolId;
    if (await this.yearModel.exists({ schoolId, name: input.name })) {
      throw Errors.conflict(`Ya existe el ciclo ${input.name}.`);
    }
    let created!: SchoolYearDocument;
    await this.connection.transaction(async (session) => {
      if (input.isCurrent) {
        await this.yearModel.updateMany({ schoolId }, { $set: { isCurrent: false } }, { session });
      }
      const docs = await this.yearModel.create(
        [
          {
            schoolId,
            name: input.name,
            startDate: dateOnlyToDate(input.startDate),
            endDate: dateOnlyToDate(input.endDate),
            isCurrent: input.isCurrent,
            createdBy: actor.user.id,
          },
        ],
        { session },
      );
      created = docs[0]!;
      await this.schemeModel.create(
        [
          {
            schoolId,
            schoolYearId: created._id,
            ...DEFAULT_GRADING_SCHEME,
            updatedBy: actor.user.id,
          },
        ],
        { session },
      );
    });
    return toYearView(created);
  }

  async update(id: string, input: UpdateSchoolYearInput, actor: Actor): Promise<SchoolYearView> {
    const year = await this.loadYear(id, actor);
    assertCan(actor.ability, 'update', 'SchoolYear', year);
    const startDate = input.startDate ?? dateToDateOnly(year.startDate);
    const endDate = input.endDate ?? dateToDateOnly(year.endDate);
    if (startDate > endDate)
      throw Errors.badRequest('La fecha de inicio debe ser anterior a la de fin.');

    await this.connection.transaction(async (session) => {
      if (input.isCurrent) {
        await this.yearModel.updateMany(
          { schoolId: year.schoolId, _id: { $ne: year._id } },
          { $set: { isCurrent: false } },
          { session },
        );
      }
      year.set({
        startDate: dateOnlyToDate(startDate),
        endDate: dateOnlyToDate(endDate),
        ...(input.isCurrent === undefined ? {} : { isCurrent: input.isCurrent }),
      });
      await year.save({ session });
    });
    return toYearView(year);
  }

  // ---- Grading scheme ------------------------------------------------------
  async getScheme(yearId: string, actor: Actor): Promise<GradingSchemeData> {
    const year = await this.loadYear(yearId, actor);
    const scheme = await this.schemeModel.findOne({ schoolYearId: year._id }).lean().exec();
    if (!scheme) return DEFAULT_GRADING_SCHEME;
    assertCan(actor.ability, 'read', 'GradingScheme', scheme);
    return toSchemeData(scheme);
  }

  async putScheme(
    yearId: string,
    input: GradingSchemeData,
    actor: Actor,
  ): Promise<GradingSchemeData> {
    const year = await this.loadYear(yearId, actor);
    assertCan(actor.ability, 'update', 'GradingScheme', { schoolId: year.schoolId });
    const scheme = await this.schemeModel
      .findOneAndUpdate(
        { schoolYearId: year._id },
        { $set: { ...input, schoolId: year.schoolId, updatedBy: actor.user.id } },
        { upsert: true, new: true },
      )
      .lean()
      .exec();
    return toSchemeData(scheme!);
  }

  // ---- Periods -------------------------------------------------------------
  async listPeriods(actor: Actor, schoolYearId?: string): Promise<PeriodView[]> {
    const filter = requireScopedQuery(actor, 'Period');
    const periods = await this.periodModel
      .find(schoolYearId ? { $and: [filter, { schoolYearId: oid(schoolYearId) }] } : filter)
      .sort({ schoolYearId: 1, number: 1 })
      .exec();
    return periods.map(toPeriodView);
  }

  async createPeriod(input: CreatePeriodInput, actor: Actor): Promise<PeriodView> {
    const year = await this.loadYear(input.schoolYearId, actor);
    assertCan(actor.ability, 'create', 'Period', { schoolId: year.schoolId });
    if (await this.periodModel.exists({ schoolYearId: year._id, number: input.number })) {
      throw Errors.conflict(`El ciclo ${year.name} ya tiene el periodo ${input.number}.`);
    }
    const period = await this.periodModel.create({
      schoolId: year.schoolId,
      schoolYearId: year._id,
      number: input.number,
      name: input.name,
      startDate: dateOnlyToDate(input.startDate),
      endDate: dateOnlyToDate(input.endDate),
      deliveryDate: input.deliveryDate ? dateOnlyToDate(input.deliveryDate) : null,
      deliveryDateText: input.deliveryDateText || null,
      createdBy: actor.user.id,
    });
    return toPeriodView(period);
  }

  async updatePeriod(id: string, input: UpdatePeriodInput, actor: Actor): Promise<PeriodView> {
    const period = await this.periodModel
      .findOne({ _id: id, schoolId: actor.user.schoolId })
      .exec();
    if (!period) throw Errors.notFound('El periodo no existe.');
    assertCan(actor.ability, 'update', 'Period', period);
    const startDate = input.startDate ?? dateToDateOnly(period.startDate);
    const endDate = input.endDate ?? dateToDateOnly(period.endDate);
    if (startDate > endDate)
      throw Errors.badRequest('La fecha de inicio debe ser anterior a la de fin.');
    period.set({
      ...(input.name ? { name: input.name } : {}),
      startDate: dateOnlyToDate(startDate),
      endDate: dateOnlyToDate(endDate),
      ...(input.deliveryDate !== undefined
        ? { deliveryDate: input.deliveryDate ? dateOnlyToDate(input.deliveryDate) : null }
        : {}),
      ...(input.deliveryDateText !== undefined
        ? { deliveryDateText: input.deliveryDateText || null }
        : {}),
    });
    await period.save();
    return toPeriodView(period);
  }
}

function toYearView(year: SchoolYearDocument): SchoolYearView {
  return {
    id: year._id.toString(),
    name: year.name,
    startDate: dateToDateOnly(year.startDate),
    endDate: dateToDateOnly(year.endDate),
    isCurrent: year.isCurrent,
  };
}

export function toPeriodView(period: PeriodDocument | (Period & { _id: unknown })): PeriodView {
  return {
    id: String(period._id),
    schoolYearId: period.schoolYearId.toString(),
    number: period.number,
    name: period.name,
    startDate: dateToDateOnly(period.startDate),
    endDate: dateToDateOnly(period.endDate),
    status: period.status,
    ...(period.deliveryDate ? { deliveryDate: dateToDateOnly(period.deliveryDate) } : {}),
    ...(period.deliveryDateText ? { deliveryDateText: period.deliveryDateText } : {}),
  };
}

function toSchemeData(scheme: GradingScheme): GradingSchemeData {
  return {
    fields: scheme.fields,
    rounding: scheme.rounding,
    lowThreshold: scheme.lowThreshold,
    lowLegend: scheme.lowLegend,
    minFinal: scheme.minFinal,
    maxFinal: scheme.maxFinal,
  };
}
