import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { PermissionGrantLike } from '@siseep/shared';
import type { Model } from 'mongoose';
import type { RequestUser } from '../common/request-user';
import { PermissionGrant } from './permission-grant.schema';

@Injectable()
export class PermissionGrantsService {
  constructor(
    @InjectModel(PermissionGrant.name) private readonly grantModel: Model<PermissionGrant>,
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
}
