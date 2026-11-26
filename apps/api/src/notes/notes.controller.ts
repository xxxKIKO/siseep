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
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  createNoteSchema,
  groupNotesQuerySchema,
  type NoteView,
  studentNotesQuerySchema,
  updateNoteSchema,
} from '@siseep/shared';
import { createZodDto } from 'nestjs-zod';
import { CheckPolicies, CurrentActor } from '../common/decorators';
import { ObjectIdPipe } from '../common/object-id.pipe';
import type { Actor } from '../common/request-user';
import { NotesService } from './notes.service';

class CreateNoteDto extends createZodDto(createNoteSchema) {}
class UpdateNoteDto extends createZodDto(updateNoteSchema) {}
class GroupNotesQueryDto extends createZodDto(groupNotesQuerySchema) {}
class StudentNotesQueryDto extends createZodDto(studentNotesQuerySchema) {}

@ApiTags('notes')
@ApiBearerAuth()
@Controller()
export class NotesController {
  constructor(private readonly notes: NotesService) {}

  @Get('groups/:id/notes')
  @CheckPolicies((ability) => ability.can('read', 'StudentNote'))
  @ApiOperation({ summary: 'Notas del grupo en un día (?date=AAAA-MM-DD)' })
  forGroup(
    @Param('id', ObjectIdPipe) id: string,
    @Query() query: GroupNotesQueryDto,
    @CurrentActor() actor: Actor,
  ): Promise<NoteView[]> {
    return this.notes.listForGroup(id, query.date, actor);
  }

  @Get('students/:id/notes')
  @CheckPolicies((ability) => ability.can('read', 'StudentNote'))
  @ApiOperation({ summary: 'Notas del alumno (?periodId=)' })
  forStudent(
    @Param('id', ObjectIdPipe) id: string,
    @Query() query: StudentNotesQueryDto,
    @CurrentActor() actor: Actor,
  ): Promise<NoteView[]> {
    return this.notes.listForStudent(id, query.periodId, actor);
  }

  @Post('students/:id/notes')
  @CheckPolicies((ability) => ability.can('create', 'StudentNote'))
  @ApiOperation({ summary: 'Nueva nota del alumno (las de Salud nunca son visibles para padres)' })
  create(
    @Param('id', ObjectIdPipe) id: string,
    @Body() dto: CreateNoteDto,
    @CurrentActor() actor: Actor,
  ): Promise<NoteView> {
    return this.notes.create(id, dto, actor);
  }

  @Patch('notes/:id')
  @CheckPolicies((ability) => ability.can('update', 'StudentNote'))
  @ApiOperation({ summary: 'Edita una nota propia' })
  update(
    @Param('id', ObjectIdPipe) id: string,
    @Body() dto: UpdateNoteDto,
    @CurrentActor() actor: Actor,
  ): Promise<NoteView> {
    return this.notes.update(id, dto, actor);
  }

  @Delete('notes/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @CheckPolicies((ability) => ability.can('delete', 'StudentNote'))
  @ApiOperation({ summary: 'Borra una nota propia' })
  remove(@Param('id', ObjectIdPipe) id: string, @CurrentActor() actor: Actor): Promise<void> {
    return this.notes.remove(id, actor);
  }
}
