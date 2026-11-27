import { Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import {
  PERIOD_GROUP_STATUS_LABELS,
  type PeriodGroupStatusView,
  type PeriodStatus,
  type PeriodTransition,
} from '@siseep/shared';
import type { Connection, Model } from 'mongoose';
import { AuditService } from '../audit/audit.service';
import { Errors } from '../common/app.exception';
import type { Actor } from '../common/request-user';
import { asSubject, oid, requireScopedQuery } from '../common/scope';
import { GroupsService } from '../groups/groups.service';
import type { PeriodGroupStatus } from '../periods/period-group-status.schema';
import { PeriodStatusService } from '../periods/period-status.service';
import { Period } from '../periods/period.schema';
import { SummaryCache } from '../summary/summary-cache.service';
import { PeriodResultsService } from './period-results.service';

/** Statuses each transition starts from. */
const FROM: Record<PeriodTransition, PeriodStatus[]> = {
  review: ['OPEN'],
  close: ['OPEN', 'IN_REVIEW'],
  publish: ['CLOSED'],
  reopen: ['IN_REVIEW', 'CLOSED', 'PUBLISHED'],
};
const TO: Record<PeriodTransition, PeriodStatus> = {
  review: 'IN_REVIEW',
  close: 'CLOSED',
  publish: 'PUBLISHED',
  reopen: 'OPEN',
};

const iso = (date: Date | null | undefined) => (date ? { value: date.toISOString() } : null);

/**
 * Period closing per group (stage 4): OPEN → IN_REVIEW → CLOSED → PUBLISHED; the admin reopens
 * with a reason. Every transition is audited in the same transaction.
 */
@Injectable()
export class ClosingService {
  constructor(
    @InjectModel(Period.name) private readonly periodModel: Model<Period>,
    @InjectConnection() private readonly connection: Connection,
    private readonly groups: GroupsService,
    private readonly results: PeriodResultsService,
    private readonly periodStatus: PeriodStatusService,
    private readonly audit: AuditService,
    private readonly summaryCache: SummaryCache,
  ) {}

  async transition(
    periodId: string,
    groupId: string,
    action: PeriodTransition,
    actor: Actor,
    reason?: string,
  ): Promise<PeriodGroupStatusView> {
    const { group, period } = await this.results.loadTarget(groupId, periodId, actor);
    const current = await this.periodStatus.effective(period._id, group._id);
    const target = { schoolId: group.schoolId, groupId: group._id };
    // Who: review = homeroom teacher (or admin); close = see canClose; publish = admin, the
    // direction or the "Cerrar y publicar periodos" permission; reopen = admin or direction.
    const allowed =
      action === 'review'
        ? actor.ability.can('update', asSubject('PeriodResult', target))
        : action === 'close'
          ? await this.results.canClose(group, actor)
          : action === 'publish'
            ? actor.ability.can('update', asSubject('Period', target))
            : // Reopen: whoever manages periods (admin, direction); a grant only updates.
              actor.ability.can('manage', asSubject('Period', target));
    if (!allowed) throw Errors.forbidden();
    if (!FROM[action].includes(current)) {
      throw Errors.invalidTransition(
        `No se puede ${ACTION_VERB[action]}: el periodo está ${PERIOD_GROUP_STATUS_LABELS[current].toLowerCase()}.`,
      );
    }
    if (action === 'reopen' && !reason?.trim()) {
      throw Errors.badRequest('Escribe el motivo para reabrir el periodo.');
    }

    const now = new Date();
    const by = oid(actor.user.id);
    const changes: Partial<PeriodGroupStatus> & { status: PeriodStatus } = { status: TO[action] };
    if (action === 'review')
      Object.assign(changes, { reviewRequestedAt: now, reviewRequestedBy: by });
    if (action === 'close') Object.assign(changes, { closedAt: now, closedBy: by });
    if (action === 'publish') Object.assign(changes, { publishedAt: now, publishedBy: by });
    if (action === 'reopen') {
      Object.assign(changes, {
        reopenedAt: now,
        reopenedBy: by,
        reopenReason: reason!.trim(),
        closedAt: null,
        closedBy: null,
        publishedAt: null,
        publishedBy: null,
      });
    }

    let snapshot: { students: number; snapshotAt: Date } | null = null;
    await this.connection.transaction(async (session) => {
      // Re-read inside the transaction: two closings at once cannot both pass.
      const status = await this.periodStatus.effective(period._id, group._id, session);
      if (!FROM[action].includes(status)) {
        throw Errors.invalidTransition('El estado del periodo cambió; actualiza la pantalla.');
      }
      if (action === 'close')
        snapshot = await this.results.writeSnapshot(group, period._id, session);
      if (action === 'reopen') await this.results.clearSnapshot(group._id, period._id, session);
      const doc = await this.periodStatus.set(
        group.schoolId,
        period._id,
        group._id,
        changes,
        session,
      );
      await this.audit.record(
        actor,
        [
          {
            action: 'update',
            entity: 'periodStatus',
            entityId: doc._id,
            groupId: group._id,
            before: { status },
            after: {
              status: TO[action],
              ...(reason ? { reason: reason.trim() } : {}),
              ...(snapshot ? { students: (snapshot as { students: number }).students } : {}),
            },
          },
        ],
        session,
      );
    });
    this.summaryCache.invalidateGroup(group._id.toString());
    const [view] = await this.list(period._id.toString(), actor, [group._id.toString()]);
    return view!;
  }

  /** Status of every visible group in a period (admin screen /admin/periodos). */
  async list(
    periodId: string,
    actor: Actor,
    onlyGroupIds?: string[],
  ): Promise<PeriodGroupStatusView[]> {
    const period = await this.periodModel
      .findOne({ _id: oid(periodId), schoolId: oid(actor.user.schoolId) })
      .lean()
      .exec();
    if (!period) throw Errors.notFound('El periodo no existe.');
    requireScopedQuery(actor, 'Period');
    const groups = (await this.groups.list(actor, period.schoolYearId.toString())).filter(
      (g) => !onlyGroupIds || onlyGroupIds.includes(g.id),
    );
    const docs = new Map(
      (await Promise.all(groups.map((g) => this.periodStatus.find(period._id, g.id)))).flatMap(
        (doc) => (doc ? [[doc.groupId.toString(), doc] as const] : []),
      ),
    );
    return groups.map((g) => {
      const doc = docs.get(g.id);
      const dates = {
        reviewRequestedAt: iso(doc?.reviewRequestedAt),
        closedAt: iso(doc?.closedAt),
        publishedAt: iso(doc?.publishedAt),
        reopenedAt: iso(doc?.reopenedAt),
      };
      return {
        periodId: period._id.toString(),
        groupId: g.id,
        groupName: g.name,
        ...(g.homeroomTeacher ? { homeroomTeacher: g.homeroomTeacher.name } : {}),
        studentCount: g.studentCount,
        status: doc?.status ?? period.status,
        ...Object.fromEntries(
          Object.entries(dates).flatMap(([key, value]) => (value ? [[key, value.value]] : [])),
        ),
        ...(doc?.reopenReason ? { reopenReason: doc.reopenReason } : {}),
      };
    });
  }
}

const ACTION_VERB: Record<PeriodTransition, string> = {
  review: 'enviar a revisión',
  close: 'cerrar',
  publish: 'publicar',
  reopen: 'reabrir',
};
