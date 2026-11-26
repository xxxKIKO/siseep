import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  createEnrollmentSchema,
  createStudentSchema,
  type Paginated,
  studentListQuerySchema,
  type StudentView,
  updateEnrollmentSchema,
  updateStudentSchema,
} from '@siseep/shared';
import { createZodDto } from 'nestjs-zod';
import { CheckPolicies, CurrentActor } from '../common/decorators';
import { ObjectIdPipe } from '../common/object-id.pipe';
import type { Actor } from '../common/request-user';
import { StudentsService } from './students.service';

class CreateStudentDto extends createZodDto(createStudentSchema) {}
class UpdateStudentDto extends createZodDto(updateStudentSchema) {}
class StudentListQueryDto extends createZodDto(studentListQuerySchema) {}
class CreateEnrollmentDto extends createZodDto(createEnrollmentSchema) {}
class UpdateEnrollmentDto extends createZodDto(updateEnrollmentSchema) {}

@ApiTags('students')
@ApiBearerAuth()
@Controller('students')
export class StudentsController {
  constructor(private readonly students: StudentsService) {}

  @Get()
  @CheckPolicies((ability) => ability.can('read', 'Student'))
  @ApiOperation({ summary: 'Alumnos de la escuela con búsqueda (?q=&page=&limit=&groupId=)' })
  list(
    @Query() query: StudentListQueryDto,
    @CurrentActor() actor: Actor,
  ): Promise<Paginated<StudentView>> {
    return this.students.list(query, actor);
  }

  @Post()
  @CheckPolicies((ability) => ability.can('create', 'Student'))
  @ApiOperation({ summary: 'Da de alta un alumno (admin)' })
  create(@Body() dto: CreateStudentDto, @CurrentActor() actor: Actor): Promise<StudentView> {
    return this.students.create(dto, actor);
  }

  @Get(':id')
  @CheckPolicies((ability) => ability.can('read', 'Student'))
  @ApiOperation({ summary: 'Detalle del alumno' })
  get(@Param('id', ObjectIdPipe) id: string, @CurrentActor() actor: Actor): Promise<StudentView> {
    return this.students.get(id, actor);
  }

  @Patch(':id')
  @CheckPolicies((ability) => ability.can('update', 'Student'))
  @ApiOperation({ summary: 'Edita datos del alumno (admin)' })
  update(
    @Param('id', ObjectIdPipe) id: string,
    @Body() dto: UpdateStudentDto,
    @CurrentActor() actor: Actor,
  ): Promise<StudentView> {
    return this.students.update(id, dto, actor);
  }
}

@ApiTags('students')
@ApiBearerAuth()
@Controller('enrollments')
export class EnrollmentsController {
  constructor(private readonly students: StudentsService) {}

  @Post()
  @CheckPolicies((ability) => ability.can('create', 'Enrollment'))
  @ApiOperation({ summary: 'Inscribe un alumno en un grupo con su N/L (admin)' })
  create(@Body() dto: CreateEnrollmentDto, @CurrentActor() actor: Actor): Promise<StudentView> {
    return this.students.enroll(dto, actor);
  }

  @Patch(':id')
  @CheckPolicies((ability) => ability.can('update', 'Enrollment'))
  @ApiOperation({ summary: 'Cambia N/L o estado (baja, cambio de escuela)' })
  update(
    @Param('id', ObjectIdPipe) id: string,
    @Body() dto: UpdateEnrollmentDto,
    @CurrentActor() actor: Actor,
  ): Promise<StudentView> {
    return this.students.updateEnrollment(id, dto, actor);
  }
}
