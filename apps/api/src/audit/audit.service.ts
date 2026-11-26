import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { AuditEntity, AuditLogView, AuditQuery, Paginated, SubjectKey } from '@siseep/shared';
import type { ClientSession, Model, Types } from 'mongoose';
import type { Actor } from '../common/request-user';
import { oid, requireScopedQuery, teacherSummary } from '../common/scope';
import { User } from '../users/user.schema';
import { AuditLog } from './audit-log.schema';

export interface AuditEntry {
  action: 'create' | 'update' | 'delete';
  entity: AuditEntity;
  entityId: Types.ObjectId | string;
  groupId?: Types.ObjectId | string | null;
  subjectKey?: SubjectKey | null;
  before?: unknown;
  after?: unknown;
}

type Person = { _id: Types.ObjectId; firstName: string; lastName?: string; email: string };

/**
 * Writes the audit log. Called by the services inside the same transaction as the change, so the
 * change and its log entry are saved together or not at all.
 */
@Injectable()
export class AuditService {
  constructor(@InjectModel(AuditLog.name) private readonly auditModel: Model<AuditLog>) {}

  async record(actor: Actor, entries: AuditEntry[], session?: ClientSession): Promise<void> {
    if (entries.length === 0) return;
    const at = new Date();
    await this.auditModel.insertMany(
      entries.map((entry) => ({
        schoolId: actor.user.schoolId,
        actorId: actor.user.id,
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId,
        groupId: entry.groupId ?? null,
        subjectKey: entry.subjectKey ?? null,
        before: entry.before ?? null,
        after: entry.after ?? null,
        at,
        ip: actor.ip ?? null,
      })),
      { session },
    );
  }

  /** Admin and director: the whole school. Teachers: their groups (and subject). */
  async list(query: AuditQuery, actor: Actor): Promise<Paginated<AuditLogView>> {
    const conditions: Record<string, unknown>[] = [requireScopedQuery(actor, 'AuditLog')];
    if (query.entity) conditions.push({ entity: query.entity });
    if (query.entityId) conditions.push({ entityId: oid(query.entityId) });
    if (query.groupId) conditions.push({ groupId: oid(query.groupId) });
    if (query.from || query.to) {
      conditions.push({
        at: {
          ...(query.from ? { $gte: new Date(query.from) } : {}),
          ...(query.to ? { $lte: new Date(query.to) } : {}),
        },
      });
    }
    const filter = { $and: conditions };
    const [total, rows] = await Promise.all([
      this.auditModel.countDocuments(filter).exec(),
      this.auditModel
        .find(filter)
        .sort({ at: -1 })
        .skip((query.page - 1) * query.limit)
        .limit(query.limit)
        .populate<{ actorId: Person }>({
          path: 'actorId',
          select: 'firstName lastName email',
          model: User.name,
        })
        .lean()
        .exec(),
    ]);
    return {
      items: rows.map((row) => ({
        id: row._id.toString(),
        actor: row.actorId
          ? { id: row.actorId._id.toString(), name: teacherSummary(row.actorId).name }
          : { id: '', name: 'Persona eliminada' },
        action: row.action,
        entity: row.entity,
        entityId: row.entityId.toString(),
        ...(row.groupId ? { groupId: row.groupId.toString() } : {}),
        before: row.before,
        after: row.after,
        at: row.at.toISOString(),
      })),
      total,
      page: query.page,
      limit: query.limit,
    };
  }
}
