import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  type PeriodGroupStatusView,
  type PeriodResultRow,
  type PeriodResultsView,
  reopenPeriodSchema,
  updatePeriodResultSchema,
} from '@siseep/shared';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { Errors } from '../common/app.exception';
import { CheckPolicies, CurrentActor } from '../common/decorators';
import { ObjectIdPipe } from '../common/object-id.pipe';
import type { Actor } from '../common/request-user';
import { ClosingService } from './closing.service';
import { PeriodResultsService } from './period-results.service';

const objectId = z.string().regex(/^[a-f\d]{24}$/i, { message: 'Periodo inválido' });
class PeriodQueryDto extends createZodDto(z.object({ periodId: objectId })) {}
class ReopenDto extends createZodDto(reopenPeriodSchema) {}
class UpdatePeriodResultDto extends createZodDto(updatePeriodResultSchema) {}

const SIMPLE_TRANSITIONS = ['review', 'close', 'publish'] as const;
type SimpleTransition = (typeof SIMPLE_TRANSITIONS)[number];

@ApiTags('closing')
@ApiBearerAuth()
@Controller()
export class ClosingController {
  constructor(
    private readonly closing: ClosingService,
    private readonly results: PeriodResultsService,
  ) {}

  @Get('groups/:id/period-results')
  @CheckPolicies((ability) => ability.can('read', 'PeriodResult'))
  @ApiOperation({
    summary: 'Resultados del periodo (cálculo en vivo si está abierto; la foto si está cerrado)',
  })
  view(
    @Param('id', ObjectIdPipe) id: string,
    @Query() query: PeriodQueryDto,
    @CurrentActor() actor: Actor,
  ): Promise<PeriodResultsView> {
    return this.results.view(id, query.periodId, actor);
  }

  @Patch('period-results/:id')
  @CheckPolicies((ability) => ability.can('update', 'PeriodResult'))
  @ApiOperation({ summary: 'Ajustes (5-10), observaciones y leyenda de un alumno' })
  update(
    @Param('id', ObjectIdPipe) id: string,
    @Body() body: UpdatePeriodResultDto,
    @CurrentActor() actor: Actor,
  ): Promise<PeriodResultRow> {
    return this.results.update(id, body, actor);
  }

  @Get('periods/:id/groups')
  @CheckPolicies((ability) => ability.can('read', 'Period'))
  @ApiOperation({ summary: 'Estado del periodo en cada grupo' })
  statuses(
    @Param('id', ObjectIdPipe) id: string,
    @CurrentActor() actor: Actor,
  ): Promise<PeriodGroupStatusView[]> {
    return this.closing.list(id, actor);
  }

  @Post('periods/:id/groups/:groupId/reopen')
  @HttpCode(HttpStatus.OK)
  @CheckPolicies((ability) => ability.can('update', 'Period'))
  @ApiOperation({ summary: 'Reabrir el periodo del grupo (solo administración, con motivo)' })
  reopen(
    @Param('id', ObjectIdPipe) id: string,
    @Param('groupId', ObjectIdPipe) groupId: string,
    @Body() body: ReopenDto,
    @CurrentActor() actor: Actor,
  ): Promise<PeriodGroupStatusView> {
    return this.closing.transition(id, groupId, 'reopen', actor, body.reason);
  }

  @Post('periods/:id/groups/:groupId/:action')
  @HttpCode(HttpStatus.OK)
  @CheckPolicies((ability) => ability.can('read', 'PeriodResult'))
  @ApiOperation({ summary: 'Enviar a revisión (review), cerrar (close) o publicar (publish)' })
  transition(
    @Param('id', ObjectIdPipe) id: string,
    @Param('groupId', ObjectIdPipe) groupId: string,
    @Param('action') action: string,
    @CurrentActor() actor: Actor,
  ): Promise<PeriodGroupStatusView> {
    if (!SIMPLE_TRANSITIONS.includes(action as SimpleTransition)) {
      throw Errors.notFound('Acción desconocida.');
    }
    return this.closing.transition(id, groupId, action as SimpleTransition, actor);
  }
}
