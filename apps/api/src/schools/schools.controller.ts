import {
  Body,
  Controller,
  Get,
  Patch,
  Put,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { LOGO_MAX_BYTES, type SchoolView, updateSchoolSchema } from '@siseep/shared';
import type { Response } from 'express';
import { createZodDto } from 'nestjs-zod';
import { CheckPolicies, CurrentActor } from '../common/decorators';
import type { Actor } from '../common/request-user';
import { SchoolsService } from './schools.service';

class UpdateSchoolDto extends createZodDto(updateSchoolSchema) {}

@ApiTags('school')
@ApiBearerAuth()
@Controller('school')
export class SchoolsController {
  constructor(private readonly schools: SchoolsService) {}

  @Get()
  @ApiOperation({ summary: 'Datos de la escuela del usuario' })
  get(@CurrentActor() actor: Actor): Promise<SchoolView> {
    return this.schools.get(actor);
  }

  @Patch()
  @CheckPolicies((ability) => ability.can('update', 'School'))
  @ApiOperation({ summary: 'Edita los datos de la escuela (admin)' })
  update(@Body() dto: UpdateSchoolDto, @CurrentActor() actor: Actor): Promise<SchoolView> {
    return this.schools.update(dto, actor);
  }

  @Put('logo')
  @CheckPolicies((ability) => ability.can('update', 'School'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Sube el logo (PNG o JPG, máximo 1 MB)' })
  // Multer stops reading a bit above the limit; the service returns the Spanish error.
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: LOGO_MAX_BYTES + 1, files: 1 } }))
  setLogo(
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentActor() actor: Actor,
  ): Promise<SchoolView> {
    return this.schools.setLogo(file, actor);
  }

  @Get('logo')
  @ApiOperation({ summary: 'Logo de la escuela' })
  async getLogo(@CurrentActor() actor: Actor, @Res() res: Response): Promise<void> {
    const logo = await this.schools.getLogo(actor);
    res.setHeader('Content-Type', logo.contentType);
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.send(logo.buffer);
  }
}
