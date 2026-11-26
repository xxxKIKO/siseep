import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type {
  CreatePermissionGrantInput,
  PermissionGrantLike,
  PermissionGrantView,
} from '@siseep/shared';
import type { Model, Types } from 'mongoose';
import { Errors } from '../common/app.exception';
import type { Actor, RequestUser } from '../common/request-user';
import { oid, teacherSummary } from '../common/scope';
import { Group } from '../groups/group.schema';
import { User } from '../users/user.schema';
import { PermissionGrant } from './permission-grant.schema';

type PersonRef = { _id: Types.ObjectId; firstName: string; lastName?: string; email: string };

@Injectable()
export class PermissionGrantsService {
  constructor(
    @InjectModel(PermissionGrant.name) private readonly grantModel: Model<PermissionGrant>,
    @InjectModel(User.name) private readonly userModel: Model<User>,
    @InjectModel(Group.name) private readonly groupModel: Model<Group>,
  ) {}

  /** Grants of the user in their school that have not expired. */
  async findActiveForUser(user: RequestUser): Promise<PermissionGrantLike[]> {
    const now = new Date();
    const grants = await this.grantModel
      .find({
        schoolId: user.schoolId,
        userId: user.id,
        deletedAt: null,
        $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }],
      })
      .lean()
      .exec();
    return grants.map((grant) => ({
      action: grant.action,
      scope: { type: grant.scope.type, groupId: grant.scope.groupId?.toString() ?? null },
      expiresAt: grant.expiresAt ?? null,
    }));
  }

  /** Every grant of the school (expired ones included, marked inactive). Admin only. */
  async list(actor: Actor, userId?: string): Promise<PermissionGrantView[]> {
    const grants = await this.grantModel
      .find({
        schoolId: actor.user.schoolId,
        deletedAt: null,
        ...(userId ? { userId: oid(userId) } : {}),
      })
      .sort({ createdAt: -1 })
      .populate<{ userId: PersonRef; grantedBy: PersonRef }>([
        { path: 'userId', select: 'firstName lastName email', model: User.name },
        { path: 'grantedBy', select: 'firstName lastName email', model: User.name },
      ])
      .lean()
      .exec();
    const groupIds = grants.flatMap((g) => (g.scope.groupId ? [g.scope.groupId] : []));
    const groups = await this.groupModel.find({ _id: { $in: groupIds } }, { name: 1 }).lean();
    const groupNames = new Map(groups.map((g) => [g._id.toString(), g.name]));
    const now = Date.now();

    return grants.map((grant) => ({
      id: grant._id.toString(),
      user: teacherSummary(grant.userId),
      action: grant.action,
      scope: {
        type: grant.scope.type,
        ...(grant.scope.groupId
          ? {
              groupId: grant.scope.groupId.toString(),
              groupName: groupNames.get(grant.scope.groupId.toString()),
            }
          : {}),
      },
      ...(grant.expiresAt ? { expiresAt: grant.expiresAt.toISOString() } : {}),
      active: !grant.expiresAt || grant.expiresAt.getTime() > now,
      grantedBy: teacherSummary(grant.grantedBy),
      ...(grant.reason ? { reason: grant.reason } : {}),
      createdAt: (grant as unknown as { createdAt: Date }).createdAt.toISOString(),
    }));
  }

  async create(input: CreatePermissionGrantInput, actor: Actor): Promise<PermissionGrantView> {
    const schoolId = actor.user.schoolId;
    const target = await this.userModel.exists({ _id: input.userId, schoolId, deletedAt: null });
    if (!target) throw Errors.notFound('La persona no existe en esta escuela.');
    if (input.scope.groupId) {
      const group = await this.groupModel.exists({
        _id: input.scope.groupId,
        schoolId,
        deletedAt: null,
      });
      if (!group) throw Errors.notFound('El grupo no existe en esta escuela.');
    }
    const grant = await this.grantModel.create({
      schoolId,
      userId: input.userId,
      action: input.action,
      scope: { type: input.scope.type, groupId: input.scope.groupId ?? undefined },
      expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
      grantedBy: actor.user.id,
      reason: input.reason,
    });
    const [view] = (await this.list(actor)).filter((g) => g.id === grant._id.toString());
    return view!;
  }

  /** Revokes a grant (soft delete: the history stays). */
  async revoke(id: string, actor: Actor): Promise<void> {
    const result = await this.grantModel
      .updateOne(
        { _id: id, schoolId: actor.user.schoolId, deletedAt: null },
        { $set: { deletedAt: new Date() } },
      )
      .exec();
    if (result.matchedCount === 0) throw Errors.notFound('El permiso no existe o ya se revocó.');
  }
}
