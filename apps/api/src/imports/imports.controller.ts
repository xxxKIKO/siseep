import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  IMPORT_MAX_BYTES,
  importCommitRequestSchema,
  type ImportCommitResult,
  type ImportPreview,
  importPreviewRequestSchema,
} from '@siseep/shared';
import { createZodDto } from 'nestjs-zod';
import { CheckPolicies, CurrentActor } from '../common/decorators';
import type { Actor } from '../common/request-user';
import { ImportsService } from './imports.service';

class ImportPreviewDto extends createZodDto(importPreviewRequestSchema) {}
class ImportCommitDto extends createZodDto(importCommitRequestSchema) {}

@ApiTags('imports')
@ApiBearerAuth()
@Controller('imports/excel')
@CheckPolicies((ability) => ability.can('create', 'Import'))
export class ImportsController {
  constructor(private readonly imports: ImportsService) {}

  @Post('preview')
  @HttpCode(HttpStatus.OK)
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Lee el Excel del grupo y muestra qué se importará (no guarda nada)' })
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: IMPORT_MAX_BYTES + 1, files: 1 } }),
  )
  preview(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: ImportPreviewDto,
    @CurrentActor() actor: Actor,
  ): Promise<ImportPreview> {
    return this.imports.preview(file, dto.groupId, dto.periodId, actor);
  }

  @Post('commit')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Importa lo que mostró la vista previa (una transacción, idempotente)' })
  commit(@Body() dto: ImportCommitDto, @CurrentActor() actor: Actor): Promise<ImportCommitResult> {
    return this.imports.commit(dto.previewId, actor);
  }
}
