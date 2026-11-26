import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { CheckPolicies, CurrentActor } from '../common/decorators';
import { ObjectIdPipe } from '../common/object-id.pipe';
import type { Actor } from '../common/request-user';
import { ReportsService } from './reports.service';

class CaptureSheetQueryDto extends createZodDto(
  z.object({
    activityId: z
      .string()
      .regex(/^[a-f\d]{24}$/i, { message: 'Actividad inválida' })
      .optional(),
  }),
) {}

@ApiTags('reports')
@ApiBearerAuth()
@Controller()
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('groups/:id/capture-sheet.pdf')
  @CheckPolicies((ability) => ability.can('read', 'Group'))
  @ApiProduces('application/pdf')
  @ApiOperation({ summary: 'Hoja de captura imprimible (?activityId=; sin él, hoja en blanco)' })
  async captureSheet(
    @Param('id', ObjectIdPipe) id: string,
    @Query() query: CaptureSheetQueryDto,
    @CurrentActor() actor: Actor,
    @Res() res: Response,
  ): Promise<void> {
    const { pdf, fileName } = await this.reports.captureSheet(id, query.activityId, actor);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="hoja-de-captura.pdf"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    );
    res.setHeader('Cache-Control', 'no-store');
    res.send(pdf);
  }
}
