import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  createAssignmentSchema,
  createGroupSchema,
  type GroupView,
  type RosterEntry,
  updateGroupSchema,
} from '@siseep/shared';
import { createZodDto } from 'nestjs-zod';
import { CheckPolicies, CurrentActor } from '../common/decorators';
import { ObjectIdPipe } from '../common/object-id.pipe';
import type { Actor } from '../common/request-user';
import { GroupsService } from './groups.service';

class CreateGroupDto extends createZodDto(createGroupSchema) {}
class UpdateGroupDto extends createZodDto(updateGroupSchema) {}
class CreateAssignmentDto extends createZodDto(createAssignmentSchema) {}

@ApiTags('groups')
@ApiBearerAuth()
@Controller('groups')
export class GroupsController {
  constructor(private readonly groups: GroupsService) {}

  @Get()
  @ApiOperation({ summary: 'Grupos visibles (maestro: solo los suyos)' })
  list(
    @CurrentActor() actor: Actor,
    @Query('schoolYearId') schoolYearId?: string,
  ): Promise<GroupView[]> {
    return this.groups.list(
      actor,
      schoolYearId && /^[a-f\d]{24}$/i.test(schoolYearId) ? schoolYearId : undefined,
    );
  }

  @Post()
  @CheckPolicies((ability) => ability.can('create', 'Group'))
  @ApiOperation({ summary: 'Crea un grupo (admin)' })
  create(@Body() dto: CreateGroupDto, @CurrentActor() actor: Actor): Promise<GroupView> {
    return this.groups.create(dto, actor);
  }

  @Get(':id')
  @CheckPolicies((ability) => ability.can('read', 'Group'))
  @ApiOperation({ summary: 'Detalle del grupo' })
  get(@Param('id', ObjectIdPipe) id: string, @CurrentActor() actor: Actor): Promise<GroupView> {
    return this.groups.get(id, actor);
  }

  @Patch(':id')
  @CheckPolicies((ability) => ability.can('update', 'Group'))
  @ApiOperation({ summary: 'Cambia el maestro titular (admin)' })
  update(
    @Param('id', ObjectIdPipe) id: string,
    @Body() dto: UpdateGroupDto,
    @CurrentActor() actor: Actor,
  ): Promise<GroupView> {
    return this.groups.update(id, dto, actor);
  }

  @Get(':id/roster')
  @CheckPolicies((ability) => ability.can('read', 'Group'))
  @ApiOperation({ summary: 'Lista del grupo por N/L' })
  roster(
    @Param('id', ObjectIdPipe) id: string,
    @CurrentActor() actor: Actor,
  ): Promise<RosterEntry[]> {
    return this.groups.roster(id, actor);
  }

  @Post(':id/assignments')
  @CheckPolicies((ability) => ability.can('create', 'TeachingAssignment'))
  @ApiOperation({ summary: 'Asigna un maestro titular o de materia (admin)' })
  addAssignment(
    @Param('id', ObjectIdPipe) id: string,
    @Body() dto: CreateAssignmentDto,
    @CurrentActor() actor: Actor,
  ): Promise<GroupView> {
    return this.groups.addAssignment(id, dto, actor);
  }

  @Delete(':id/assignments/:assignmentId')
  @CheckPolicies((ability) => ability.can('delete', 'TeachingAssignment'))
  @ApiOperation({ summary: 'Quita una asignación (admin)' })
  removeAssignment(
    @Param('id', ObjectIdPipe) id: string,
    @Param('assignmentId', ObjectIdPipe) assignmentId: string,
    @CurrentActor() actor: Actor,
  ): Promise<GroupView> {
    return this.groups.removeAssignment(id, assignmentId, actor);
  }
}
