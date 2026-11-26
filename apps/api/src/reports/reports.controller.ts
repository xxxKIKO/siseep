import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { CheckPolicies, CurrentActor } from '../common/decorators';
import { ObjectIdPipe } from '../common/object-id.pipe';
import type { Actor } from '../common/request-user';
import { type ReportFile, ReportCardsService } from './report-cards.service';
import { ReportsService } from './reports.service';

const objectId = (message: string) => z.string().regex(/^[a-f\d]{24}$/i, { message });
class ReportCardsQueryDto extends createZodDto(
  z.object({ periodId: objectId('Periodo inválido') }),
) {}
class PreviewQueryDto extends createZodDto(
  z.object({
    periodId: objectId('Periodo inválido'),
    studentId: objectId('Alumno inválido').optional(),
  }),
) {}

const PDF = 'application/pdf';
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** Sends a generated file with an ASCII fallback name and the real UTF-8 name ("5°B"). */
function sendFile(res: Response, file: ReportFile, contentType: string, fallback: string): void {
  res.setHeader('Content-Type', contentType);
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
  );
  res.setHeader('Cache-Control', 'no-store');
  res.send(file.buffer);
}

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
  constructor(
    private readonly reports: ReportsService,
    private readonly reportCards: ReportCardsService,
  ) {}

  @Get('groups/:id/report-cards.pdf')
  @CheckPolicies((ability) => ability.can('read', 'PeriodResult'))
  @ApiProduces(PDF)
  @ApiOperation({ summary: 'Boletas del grupo en PDF (una por página)' })
  async groupPdf(
    @Param('id', ObjectIdPipe) id: string,
    @Query() query: ReportCardsQueryDto,
    @CurrentActor() actor: Actor,
    @Res() res: Response,
  ): Promise<void> {
    sendFile(res, await this.reportCards.groupPdf(id, query.periodId, actor), PDF, 'boletas.pdf');
  }

  @Get('groups/:id/report-cards.docx')
  @CheckPolicies((ability) => ability.can('read', 'PeriodResult'))
  @ApiProduces(DOCX)
  @ApiOperation({ summary: 'Boletas del grupo en Word (una por página)' })
  async groupDocx(
    @Param('id', ObjectIdPipe) id: string,
    @Query() query: ReportCardsQueryDto,
    @CurrentActor() actor: Actor,
    @Res() res: Response,
  ): Promise<void> {
    sendFile(
      res,
      await this.reportCards.groupDocx(id, query.periodId, actor),
      DOCX,
      'boletas.docx',
    );
  }

  @Get('groups/:id/report-cards.html')
  @CheckPolicies((ability) => ability.can('read', 'PeriodResult'))
  @ApiProduces('text/html')
  @ApiOperation({ summary: 'Vista previa de las boletas en HTML (?studentId= para una sola)' })
  async preview(
    @Param('id', ObjectIdPipe) id: string,
    @Query() query: PreviewQueryDto,
    @CurrentActor() actor: Actor,
    @Res() res: Response,
  ): Promise<void> {
    const data = await this.reportCards.data(id, query.periodId, actor, query.studentId);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.send(this.reportCards.html(data, 'screen'));
  }

  @Get('students/:id/report-card.pdf')
  @CheckPolicies((ability) => ability.can('read', 'PeriodResult'))
  @ApiProduces(PDF)
  @ApiOperation({ summary: 'Boleta de un alumno en PDF' })
  async studentPdf(
    @Param('id', ObjectIdPipe) id: string,
    @Query() query: ReportCardsQueryDto,
    @CurrentActor() actor: Actor,
    @Res() res: Response,
  ): Promise<void> {
    sendFile(res, await this.reportCards.studentPdf(id, query.periodId, actor), PDF, 'boleta.pdf');
  }

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
