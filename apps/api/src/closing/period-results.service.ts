import { Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import {
  assertValidOverride,
  type ClosingIssue,
  type FieldKey,
  GradingError,
  MAIN_COMPONENTS,
  type MainComponent,
  type PeriodResultField,
  type PeriodResultRow,
  type PeriodResultsView,
  type PeriodStatus,
  Role,
  type UpdatePeriodResultInput,
} from '@siseep/shared';
import type { ClientSession, Connection, Model, Types } from 'mongoose';
import { AuditService } from '../audit/audit.service';
import { Errors } from '../common/app.exception';
import type { Actor } from '../common/request-user';
import { asSubject, assertCan, oid } from '../common/scope';
import type { GroupDocument } from '../groups/group.schema';
import { GroupsService } from '../groups/groups.service';
import { NotesService } from '../notes/notes.service';
import {
  PeriodResult,
  type PeriodResultDocument,
  type PeriodResultField as StoredField,
} from '../period-results/period-result.schema';
import { PeriodStatusService } from '../periods/period-status.service';
import { Period, type PeriodDocument } from '../periods/period.schema';
import { School } from '../schools/school.schema';
import { type GroupPeriodData, PeriodDataService } from '../summary/period-data.service';
import { SummaryCache } from '../summary/summary-cache.service';

type LeanResult = PeriodResult & { _id: Types.ObjectId; updatedAt?: Date };

const LOCKED: PeriodStatus[] = ['CLOSED', 'PUBLISHED'];
const isLocked = (status: PeriodStatus) => LOCKED.includes(status);

/** Plain copy of a result for the audit log. */
function auditCopy(doc: PeriodResultDocument) {
  return {
    fields: doc.fields.map((f) => ({
      fieldKey: f.fieldKey,
      override: f.override ?? null,
      overrideReason: f.overrideReason ?? null,
    })),
    observations: {
      general: doc.observations?.general ?? null,
      byField: { ...(doc.observations?.byField ?? {}) },
    },
    legendOverride: doc.legendOverride ?? null,
  };
}

const blankToNull = (value: string | null | undefined) =>
  value === undefined ? undefined : value && value.trim() ? value.trim() : null;

/**
 * Period results of a group (stage 4): the live engine calculation merged with the teacher's
 * adjustments and observations while the period is OPEN / IN_REVIEW, and the stored snapshot
 * once it is CLOSED. Also builds the closing snapshot and the list of blocking issues.
 */
@Injectable()
export class PeriodResultsService {
  constructor(
    @InjectModel(PeriodResult.name) private readonly resultModel: Model<PeriodResult>,
    @InjectModel(Period.name) private readonly periodModel: Model<Period>,
    @InjectModel(School.name) private readonly schoolModel: Model<School>,
    @InjectConnection() private readonly connection: Connection,
    private readonly groups: GroupsService,
    private readonly notes: NotesService,
    private readonly periodData: PeriodDataService,
    private readonly periodStatus: PeriodStatusService,
    private readonly audit: AuditService,
    private readonly summaryCache: SummaryCache,
  ) {}

  // ---- reads ----------------------------------------------------------------------
  /** Group + period the actor may read results of (homeroom, director, admin). */
  async loadTarget(
    groupId: string,
    periodId: string,
    actor: Actor,
  ): Promise<{ group: GroupDocument; period: PeriodDocument }> {
    const group = await this.groups.load(groupId, actor);
    assertCan(actor.ability, 'read', 'PeriodResult', {
      schoolId: group.schoolId,
      groupId: group._id,
    });
    const period = await this.periodModel
      .findOne({ _id: oid(periodId), schoolId: group.schoolId })
      .exec();
    if (!period) throw Errors.notFound('El periodo no existe.');
    if (!period.schoolYearId.equals(group.schoolYearId)) {
      throw Errors.badRequest('El periodo no pertenece al ciclo escolar del grupo.');
    }
    return { group, period };
  }

  async view(groupId: string, periodId: string, actor: Actor): Promise<PeriodResultsView> {
    const { group, period } = await this.loadTarget(groupId, periodId, actor);
    const status = await this.periodStatus.effective(period._id, group._id);
    const can = await this.permissions(group, status, actor);
    // PATCH needs a document per student: create the missing ones (empty) for editors.
    if (can.edit) await this.ensureDocuments(group, period._id);
    const [data, notes] = await Promise.all([
      this.periodData.load(group, period._id),
      this.notes.listForGroupPeriod(group._id, period._id, actor),
    ]);
    const rows = this.rows(data, status);
    return {
      group: { id: group._id.toString(), name: group.name },
      period: { id: period._id.toString(), name: period.name, number: period.number },
      status,
      can,
      rows,
      progress: {
        total: rows.length,
        withObservations: rows.filter(
          (r) =>
            Boolean(r.observations.general) ||
            Object.values(r.observations.byField).some((text) => Boolean(text)),
        ).length,
      },
      issues: isLocked(status) ? [] : this.issues(data),
      notes,
    };
  }

  /** What the actor may do with the group's period right now (the endpoints check again). */
  async permissions(
    group: GroupDocument,
    status: PeriodStatus,
    actor: Actor,
  ): Promise<PeriodResultsView['can']> {
    const target = { schoolId: group.schoolId, groupId: group._id };
    const canEditResults = actor.ability.can('update', asSubject('PeriodResult', target));
    return {
      edit: canEditResults && !isLocked(status),
      review: canEditResults && status === 'OPEN',
      close: (status === 'OPEN' || status === 'IN_REVIEW') && (await this.canClose(group, actor)),
      publish: status === 'CLOSED' && actor.ability.can('update', asSubject('Period', target)),
      reopen: status !== 'OPEN' && actor.user.roles.includes(Role.ADMIN),
    };
  }

  /**
   * Admin, a holder of the "Cerrar y publicar periodos" permission, or the homeroom teacher
   * when the school lets teachers close their own group.
   */
  async canClose(group: GroupDocument, actor: Actor): Promise<boolean> {
    const target = { schoolId: group.schoolId, groupId: group._id };
    if (actor.ability.can('update', asSubject('Period', target))) return true;
    if (!actor.user.roles.includes(Role.TEACHER)) return false;
    if (!group.homeroomTeacherId?.equals(actor.user.id)) return false;
    const school = await this.schoolModel
      .findById(group.schoolId, { teacherCanClosePeriod: 1 })
      .lean()
      .exec();
    return Boolean(school?.teacherCanClosePeriod);
  }

  /** Rows for the screen and the report cards. */
  rows(data: GroupPeriodData, status: PeriodStatus): PeriodResultRow[] {
    const stored = new Map(data.results.map((r) => [r.studentId.toString(), r as LeanResult]));
    const complementaryOf = new Map(
      data.scheme.fields.map((f) => [f.key, Boolean(f.complementary)]),
    );
    return data.rows.map(({ student, result }) => {
      const doc = stored.get(student.id);
      const reasonOf = (key: FieldKey) =>
        doc?.fields.find((f) => f.fieldKey === key)?.overrideReason ?? null;
      const observations = {
        general: doc?.observations?.general ?? null,
        byField: Object.fromEntries(
          Object.entries(doc?.observations?.byField ?? {}).filter(([, text]) => Boolean(text)),
        ) as Partial<Record<FieldKey, string>>,
      };
      const base = {
        id: doc?._id.toString() ?? '',
        student,
        legendOverride: doc?.legendOverride ?? null,
        observations,
      };
      if (isLocked(status) && doc?.snapshotAt) {
        // Closed: exactly what was stored when closing (grades can no longer change it).
        const fields = doc.fields.map((f): PeriodResultField => {
          const components = f.components ?? {};
          return {
            fieldKey: f.fieldKey,
            components: Object.fromEntries(
              MAIN_COMPONENTS.map((c) => [c, { value: components[c] ?? null }]),
            ) as Record<MainComponent, { value: number | null }>,
            complementary: complementaryOf.get(f.fieldKey)
              ? { value: components.COMPLEMENTARIA ?? null }
              : null,
            base: f.base ?? null,
            calculated: f.calculated ?? null,
            rounded: f.rounded ?? null,
            override: f.override ?? null,
            overrideReason: f.overrideReason ?? null,
            final: f.final ?? null,
            adjusted: f.override !== null && f.override !== undefined,
            partial: false,
            pending: 0,
          };
        });
        return {
          ...base,
          fields,
          generalAverage: doc.generalAverage ?? null,
          legendSuggested: doc.legendSuggested ?? null,
          source: 'snapshot' as const,
          snapshotAt: doc.snapshotAt.toISOString(),
        };
      }
      return {
        ...base,
        fields: result.fields.map((f): PeriodResultField => ({
          fieldKey: f.fieldKey,
          components: f.components,
          complementary: f.complementary,
          base: f.base,
          calculated: f.calculated,
          rounded: f.rounded,
          override: f.override,
          overrideReason: f.adjusted ? reasonOf(f.fieldKey) : null,
          final: f.final,
          adjusted: f.adjusted,
          partial: f.partial,
          pending: f.pending,
        })),
        generalAverage: result.generalAverage,
        legendSuggested: result.legendSuggested,
        source: 'live' as const,
        snapshotAt: null,
      };
    });
  }

  /** Fields that block the closing: activities without a grade, or a missing component. */
  issues(data: GroupPeriodData): ClosingIssue[] {
    const graded = new Set(
      data.grades.map((g) => `${g.studentId.toString()}:${g.activityId.toString()}`),
    );
    const issues: ClosingIssue[] = [];
    for (const { student, result } of data.rows) {
      for (const field of result.fields) {
        if (field.pending === 0 && !field.partial && field.calculated !== null) continue;
        issues.push({
          studentId: student.id,
          studentName: student.fullName,
          listNumber: student.listNumber,
          fieldKey: field.fieldKey,
          activityIds: data.activities
            .filter(
              (a) =>
                a.fieldKey === field.fieldKey && !graded.has(`${student.id}:${a._id.toString()}`),
            )
            .map((a) => a._id.toString()),
          missingComponents: field.missing,
        });
      }
    }
    return issues;
  }

  // ---- writes ---------------------------------------------------------------------
  async update(id: string, input: UpdatePeriodResultInput, actor: Actor): Promise<PeriodResultRow> {
    const doc = await this.resultModel
      .findOne({ _id: oid(id), schoolId: oid(actor.user.schoolId) })
      .exec();
    if (!doc) throw Errors.notFound('El resultado no existe.');
    const group = await this.groups.load(doc.groupId.toString(), actor);
    assertCan(actor.ability, 'update', 'PeriodResult', doc);
    const data = await this.periodData.load(group, doc.periodId);
    const before = auditCopy(doc);

    for (const change of input.fields ?? []) {
      try {
        assertValidOverride(data.scheme, change.override);
      } catch (error) {
        if (error instanceof GradingError) throw Errors.badRequest(error.message);
        throw error;
      }
      let field = doc.fields.find((f) => f.fieldKey === change.fieldKey);
      if (!field) {
        doc.fields.push({ fieldKey: change.fieldKey } as StoredField);
        field = doc.fields[doc.fields.length - 1]!;
      }
      if (change.override !== undefined) field.override = change.override;
      const reason = blankToNull(change.overrideReason);
      if (reason !== undefined) field.overrideReason = reason;
      if (field.override === null || field.override === undefined) field.overrideReason = null;
    }
    if (input.observations) {
      const general = blankToNull(input.observations.general);
      if (general !== undefined) doc.observations.general = general;
      const byField = { ...(doc.observations.byField ?? {}) };
      for (const [key, text] of Object.entries(input.observations.byField ?? {})) {
        const value = blankToNull(text);
        if (value) byField[key as FieldKey] = value;
        else delete byField[key as FieldKey];
      }
      doc.observations.byField = byField;
      doc.markModified('observations');
    }
    const legend = blankToNull(input.legendOverride);
    if (legend !== undefined) doc.legendOverride = legend;

    await this.connection.transaction(async (session) => {
      // Checked inside the transaction: a closing that lands first wins.
      await this.periodStatus.assertResultsEditable(doc.periodId, doc.groupId, session);
      await doc.save({ session });
      await this.audit.record(
        actor,
        [
          {
            action: 'update',
            entity: 'periodResult',
            entityId: doc._id,
            groupId: doc.groupId,
            before,
            after: auditCopy(doc),
          },
        ],
        session,
      );
    });
    this.summaryCache.invalidateGroup(doc.groupId.toString());

    const fresh = await this.periodData.load(group, doc.periodId);
    const row = this.rows(fresh, 'OPEN').find((r) => r.id === doc._id.toString());
    if (!row) throw Errors.notFound('El alumno ya no está activo en el grupo.');
    return row;
  }

  /** One (possibly empty) results document per active student. */
  async ensureDocuments(
    group: GroupDocument,
    periodId: Types.ObjectId,
    session?: ClientSession,
  ): Promise<void> {
    const data = await this.periodData.load(group, periodId, session);
    const existing = new Set(data.results.map((r) => r.studentId.toString()));
    const missing = data.rows.filter((r) => !existing.has(r.student.id));
    if (missing.length === 0) return;
    await this.resultModel.bulkWrite(
      missing.map((r) => ({
        updateOne: {
          filter: { periodId, studentId: oid(r.student.id) },
          update: {
            $setOnInsert: {
              schoolId: group.schoolId,
              periodId,
              groupId: group._id,
              studentId: oid(r.student.id),
              fields: [],
              observations: { general: null, byField: {} },
            },
          },
          upsert: true,
        },
      })),
      { session },
    );
  }

  /**
   * Closing snapshot: the engine's full result per student (components, calculated, rounded,
   * override, final, general average, suggested legend). Throws 422 with the blocking fields.
   */
  async writeSnapshot(group: GroupDocument, periodId: Types.ObjectId, session: ClientSession) {
    await this.ensureDocuments(group, periodId, session);
    const data = await this.periodData.load(group, periodId, session);
    const issues = this.issues(data);
    if (issues.length > 0) throw Errors.periodIncomplete(issues);
    if (data.rows.length === 0) {
      throw Errors.invalidTransition('El grupo no tiene alumnos activos.');
    }
    const snapshotAt = new Date();
    const stored = new Map(data.results.map((r) => [r.studentId.toString(), r]));
    await this.resultModel.bulkWrite(
      data.rows.map(({ student, result }) => {
        const previous = stored.get(student.id);
        return {
          updateOne: {
            filter: { periodId, studentId: oid(student.id) },
            update: {
              $set: {
                fields: result.fields.map((f) => ({
                  fieldKey: f.fieldKey,
                  components: {
                    DESEMPENO: f.components.DESEMPENO.value,
                    PROYECTO: f.components.PROYECTO.value,
                    EXAMEN: f.components.EXAMEN.value,
                    ...(f.complementary ? { COMPLEMENTARIA: f.complementary.value } : {}),
                  },
                  base: f.base,
                  calculated: f.calculated,
                  rounded: f.rounded,
                  override: f.override,
                  overrideReason: f.adjusted
                    ? (previous?.fields.find((p) => p.fieldKey === f.fieldKey)?.overrideReason ??
                      null)
                    : null,
                  final: f.final,
                })),
                generalAverage: result.generalAverage,
                legendSuggested: result.legendSuggested,
                snapshotAt,
              },
            },
          },
        };
      }),
      { session },
    );
    return { students: data.rows.length, snapshotAt };
  }

  /** Reopening: back to the live calculation (adjustments and observations are kept). */
  async clearSnapshot(groupId: Types.ObjectId, periodId: Types.ObjectId, session: ClientSession) {
    await this.resultModel.updateMany(
      { groupId, periodId },
      { $set: { snapshotAt: null } },
      { session },
    );
  }
}
