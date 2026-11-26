import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  activityListQuerySchema,
  type ActivityGradesView,
  type ActivityView,
  createActivitySchema,
  saveGradesSchema,
  type SaveGradesResult,
  type StudentGradesView,
  updateActivitySchema,
} from '@siseep/shared';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { CheckPolicies, CurrentActor } from '../common/decorators';
import { ObjectIdPipe } from '../common/object-id.pipe';
import type { Actor } from '../common/request-user';
import { ActivitiesService } from './activities.service';
import { GradesService } from './grades.service';

class ActivityListQueryDto extends createZodDto(activityListQuerySchema) {}
class CreateActivityDto extends createZodDto(createActivitySchema) {}
class UpdateActivityDto extends createZodDto(updateActivitySchema) {}
class SaveGradesDto extends createZodDto(saveGradesSchema) {}
class DeleteActivityQueryDto extends createZodDto(
  z.object({ force: z.enum(['true', 'false']).optional() }),
) {}
class StudentGradesQueryDto extends createZodDto(
  z.object({ periodId: z.string().regex(/^[a-f\d]{24}$/i, { message: 'Periodo inválido' }) }),
) {}

@ApiTags('activities')
@ApiBearerAuth()
@Controller()
export class ActivitiesController {
  constructor(
    private readonly activities: ActivitiesService,
    private readonly grades: GradesService,
  ) {}

  @Get('groups/:id/activities')
  @CheckPolicies((ability) => ability.can('read', 'Activity'))
  @ApiOperation({ summary: 'Actividades del grupo (?periodId=&fieldKey=&component=)' })
  list(
    @Param('id', ObjectIdPipe) id: string,
    @Query() query: ActivityListQueryDto,
    @CurrentActor() actor: Actor,
  ): Promise<ActivityView[]> {
    return this.activities.listForGroup(id, query, actor);
  }

  @Post('activities')
  @CheckPolicies((ability) => ability.can('create', 'Activity'))
  @ApiOperation({ summary: 'Nueva actividad (periodo abierto)' })
  create(@Body() dto: CreateActivityDto, @CurrentActor() actor: Actor): Promise<ActivityView> {
    return this.activities.create(dto, actor);
  }

  @Get('activities/:id')
  @CheckPolicies((ability) => ability.can('read', 'Activity'))
  @ApiOperation({ summary: 'Detalle de la actividad' })
  get(@Param('id', ObjectIdPipe) id: string, @CurrentActor() actor: Actor): Promise<ActivityView> {
    return this.activities.get(id, actor);
  }

  @Patch('activities/:id')
  @CheckPolicies((ability) => ability.can('update', 'Activity'))
  @ApiOperation({ summary: 'Edita la actividad (periodo abierto)' })
  update(
    @Param('id', ObjectIdPipe) id: string,
    @Body() dto: UpdateActivityDto,
    @CurrentActor() actor: Actor,
  ): Promise<ActivityView> {
    return this.activities.update(id, dto, actor);
  }

  @Delete('activities/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @CheckPolicies((ability) => ability.can('delete', 'Activity'))
  @ApiOperation({ summary: 'Borra la actividad; con calificaciones exige ?force=true' })
  remove(
    @Param('id', ObjectIdPipe) id: string,
    @Query() query: DeleteActivityQueryDto,
    @CurrentActor() actor: Actor,
  ): Promise<void> {
    return this.activities.remove(id, query.force === 'true', actor);
  }

  @Get('activities/:id/grades')
  @CheckPolicies((ability) => ability.can('read', 'Grade'))
  @ApiOperation({ summary: 'Lista del grupo por N/L con su calificación en la actividad' })
  getGrades(
    @Param('id', ObjectIdPipe) id: string,
    @CurrentActor() actor: Actor,
  ): Promise<ActivityGradesView> {
    return this.grades.forActivity(id, actor);
  }

  @Put('activities/:id/grades')
  @CheckPolicies((ability) => ability.can('update', 'Grade'))
  @ApiOperation({
    summary: 'Guarda un lote de calificaciones (transacción, control de concurrencia)',
  })
  saveGrades(
    @Param('id', ObjectIdPipe) id: string,
    @Body() dto: SaveGradesDto,
    @CurrentActor() actor: Actor,
  ): Promise<SaveGradesResult> {
    return this.grades.save(id, dto.grades, actor);
  }

  @Get('students/:id/grades')
  @CheckPolicies((ability) => ability.can('read', 'Grade'))
  @ApiOperation({ summary: 'Calificaciones del alumno en el periodo, por campo (?periodId=)' })
  studentGrades(
    @Param('id', ObjectIdPipe) id: string,
    @Query() query: StudentGradesQueryDto,
    @CurrentActor() actor: Actor,
  ): Promise<StudentGradesView> {
    return this.grades.forStudent(id, query.periodId, actor);
  }
}
