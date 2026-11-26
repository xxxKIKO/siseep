import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { activityListQuerySchema, type ActivityView, updateActivitySchema } from '@siseep/shared';
import { createZodDto } from 'nestjs-zod';
import { CheckPolicies, CurrentActor } from '../common/decorators';
import { ObjectIdPipe } from '../common/object-id.pipe';
import type { Actor } from '../common/request-user';
import { ActivitiesService } from './activities.service';

class ActivityListQueryDto extends createZodDto(activityListQuerySchema) {}
class UpdateActivityDto extends createZodDto(updateActivitySchema) {}

@ApiTags('activities')
@ApiBearerAuth()
@Controller()
export class ActivitiesController {
  constructor(private readonly activities: ActivitiesService) {}

  @Get('groups/:id/activities')
  @CheckPolicies((ability) => ability.can('read', 'Activity'))
  @ApiOperation({ summary: 'Actividades del grupo en un periodo (?periodId=&fieldKey=)' })
  list(
    @Param('id', ObjectIdPipe) id: string,
    @Query() query: ActivityListQueryDto,
    @CurrentActor() actor: Actor,
  ): Promise<ActivityView[]> {
    return this.activities.listForGroup(id, query, actor);
  }

  @Patch('activities/:id')
  @CheckPolicies((ability) => ability.can('update', 'Activity'))
  @ApiOperation({ summary: 'Corrige el nombre o la fecha de una actividad (periodo abierto)' })
  update(
    @Param('id', ObjectIdPipe) id: string,
    @Body() dto: UpdateActivityDto,
    @CurrentActor() actor: Actor,
  ): Promise<ActivityView> {
    return this.activities.update(id, dto, actor);
  }
}
