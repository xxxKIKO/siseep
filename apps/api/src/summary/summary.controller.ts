import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  type GroupOverview,
  type GroupSummary,
  type StudentSummaryView,
  summaryQuerySchema,
} from '@siseep/shared';
import { createZodDto } from 'nestjs-zod';
import { CheckPolicies, CurrentActor } from '../common/decorators';
import { ObjectIdPipe } from '../common/object-id.pipe';
import type { Actor } from '../common/request-user';
import { SummaryService } from './summary.service';

class SummaryQueryDto extends createZodDto(summaryQuerySchema) {}

@ApiTags('summary')
@ApiBearerAuth()
@Controller()
export class SummaryController {
  constructor(private readonly summary: SummaryService) {}

  @Get('groups/:id/summary')
  @CheckPolicies((ability) => ability.can('read', 'Grade'))
  @ApiOperation({
    summary: 'Promedios en vivo del grupo, alertas y avance de captura (?periodId=). Caché 30 s',
  })
  group(
    @Param('id', ObjectIdPipe) id: string,
    @Query() query: SummaryQueryDto,
    @CurrentActor() actor: Actor,
  ): Promise<GroupSummary> {
    return this.summary.forGroup(id, query.periodId, actor);
  }

  @Get('students/:id/summary')
  @CheckPolicies((ability) => ability.can('read', 'Grade'))
  @ApiOperation({ summary: 'Resumen del alumno con el detalle por actividad (?periodId=)' })
  student(
    @Param('id', ObjectIdPipe) id: string,
    @Query() query: SummaryQueryDto,
    @CurrentActor() actor: Actor,
  ): Promise<StudentSummaryView> {
    return this.summary.forStudent(id, query.periodId, actor);
  }

  @Get('dashboard/groups')
  @CheckPolicies((ability) => ability.can('read', 'Group'))
  @ApiOperation({ summary: 'Tablero: grupos con avance de captura, promedios y alertas' })
  overview(@CurrentActor() actor: Actor): Promise<GroupOverview[]> {
    return this.summary.overview(actor);
  }
}
