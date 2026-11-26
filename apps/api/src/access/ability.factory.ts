import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  type AppAbility,
  defineAbilityFor,
  Role,
  type TeachingAssignmentLike,
} from '@siseep/shared';
import type { Model } from 'mongoose';
import type { RequestUser } from '../common/request-user';
import { TeachingAssignment } from '../groups/teaching-assignment.schema';
import { PermissionGrantsService } from '../permission-grants/permission-grants.service';

/** Builds the CASL ability of a user from their roles, active grants and teaching assignments. */
@Injectable()
export class AbilityFactory {
  constructor(
    private readonly grants: PermissionGrantsService,
    @InjectModel(TeachingAssignment.name)
    private readonly assignmentModel: Model<TeachingAssignment>,
  ) {}

  async forUser(user: RequestUser): Promise<AppAbility> {
    if (user.roles.includes(Role.ADMIN)) return defineAbilityFor(user);
    const [grants, assignments] = await Promise.all([
      this.grants.findActiveForUser(user),
      user.roles.includes(Role.TEACHER) ? this.assignmentsOf(user) : Promise.resolve([]),
    ]);
    return defineAbilityFor(user, { grants, assignments });
  }

  private async assignmentsOf(user: RequestUser): Promise<TeachingAssignmentLike[]> {
    const rows = await this.assignmentModel
      .find({ schoolId: user.schoolId, teacherId: user.id, deletedAt: null })
      .lean()
      .exec();
    return rows.map((row) => ({
      groupId: row.groupId.toString(),
      scope: row.scope,
      subjectKey: row.subjectKey ?? null,
    }));
  }
}
