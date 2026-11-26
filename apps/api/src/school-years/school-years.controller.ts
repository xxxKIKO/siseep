import { Body, Controller, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  createPeriodSchema,
  createSchoolYearSchema,
  type GradingScheme,
  gradingSchemeSchema,
  type PeriodView,
  type SchoolYearView,
  updatePeriodSchema,
  updateSchoolYearSchema,
} from '@siseep/shared';
import { createZodDto } from 'nestjs-zod';
import { CheckPolicies, CurrentActor } from '../common/decorators';
import { ObjectIdPipe } from '../common/object-id.pipe';
import type { Actor } from '../common/request-user';
import { SchoolYearsService } from './school-years.service';

class CreateSchoolYearDto extends createZodDto(createSchoolYearSchema) {}
class UpdateSchoolYearDto extends createZodDto(updateSchoolYearSchema) {}
class GradingSchemeDto extends createZodDto(gradingSchemeSchema) {}
class CreatePeriodDto extends createZodDto(createPeriodSchema) {}
class UpdatePeriodDto extends createZodDto(updatePeriodSchema) {}

@ApiTags('school-years')
@ApiBearerAuth()
@Controller('school-years')
export class SchoolYearsController {
  constructor(private readonly years: SchoolYearsService) {}

  @Get()
  @CheckPolicies((ability) => ability.can('read', 'SchoolYear'))
  @ApiOperation({ summary: 'Ciclos escolares' })
  list(@CurrentActor() actor: Actor): Promise<SchoolYearView[]> {
    return this.years.list(actor);
  }

  @Post()
  @CheckPolicies((ability) => ability.can('create', 'SchoolYear'))
  @ApiOperation({ summary: 'Crea un ciclo escolar (con las reglas de cálculo por defecto)' })
  create(@Body() dto: CreateSchoolYearDto, @CurrentActor() actor: Actor): Promise<SchoolYearView> {
    return this.years.create(dto, actor);
  }

  @Patch(':id')
  @CheckPolicies((ability) => ability.can('update', 'SchoolYear'))
  @ApiOperation({ summary: 'Edita fechas o marca el ciclo actual' })
  update(
    @Param('id', ObjectIdPipe) id: string,
    @Body() dto: UpdateSchoolYearDto,
    @CurrentActor() actor: Actor,
  ): Promise<SchoolYearView> {
    return this.years.update(id, dto, actor);
  }

  @Get(':id/grading-scheme')
  @CheckPolicies((ability) => ability.can('read', 'GradingScheme'))
  @ApiOperation({ summary: 'Reglas de cálculo del ciclo' })
  getScheme(
    @Param('id', ObjectIdPipe) id: string,
    @CurrentActor() actor: Actor,
  ): Promise<GradingScheme> {
    return this.years.getScheme(id, actor);
  }

  @Put(':id/grading-scheme')
  @CheckPolicies((ability) => ability.can('update', 'GradingScheme'))
  @ApiOperation({ summary: 'Cambia las reglas de cálculo del ciclo' })
  putScheme(
    @Param('id', ObjectIdPipe) id: string,
    @Body() dto: GradingSchemeDto,
    @CurrentActor() actor: Actor,
  ): Promise<GradingScheme> {
    return this.years.putScheme(id, dto, actor);
  }
}

@ApiTags('periods')
@ApiBearerAuth()
@Controller('periods')
export class PeriodsController {
  constructor(private readonly years: SchoolYearsService) {}

  @Get()
  @CheckPolicies((ability) => ability.can('read', 'Period'))
  @ApiOperation({ summary: 'Periodos (opcional: ?schoolYearId=)' })
  list(
    @CurrentActor() actor: Actor,
    @Query('schoolYearId') schoolYearId?: string,
  ): Promise<PeriodView[]> {
    return this.years.listPeriods(
      actor,
      schoolYearId && /^[a-f\d]{24}$/i.test(schoolYearId) ? schoolYearId : undefined,
    );
  }

  @Post()
  @CheckPolicies((ability) => ability.can('create', 'Period'))
  @ApiOperation({ summary: 'Crea un periodo del ciclo' })
  create(@Body() dto: CreatePeriodDto, @CurrentActor() actor: Actor): Promise<PeriodView> {
    return this.years.createPeriod(dto, actor);
  }

  @Patch(':id')
  @CheckPolicies((ability) => ability.can('update', 'Period'))
  @ApiOperation({ summary: 'Edita nombre y fechas del periodo' })
  update(
    @Param('id', ObjectIdPipe) id: string,
    @Body() dto: UpdatePeriodDto,
    @CurrentActor() actor: Actor,
  ): Promise<PeriodView> {
    return this.years.updatePeriod(id, dto, actor);
  }
}
