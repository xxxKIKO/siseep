import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import {
  type AppAbility,
  type ChildActivity,
  type ChildNote,
  type ChildOverview,
  type ChildReportCard,
  type ChildView,
  type CreatedAccountView,
  createGuardianSchema,
  type GroupGuardianRow,
  type GuardianLinkView,
  type StudentHistory,
  subject,
  type TemporaryPasswordView,
} from '@siseep/shared';
import type { Response } from 'express';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { CheckPolicies, CurrentActor } from '../common/decorators';
import { ObjectIdPipe } from '../common/object-id.pipe';
import type { Actor, AuthenticatedRequest } from '../common/request-user';
import { GuardianAccountsService } from './guardian-accounts.service';
import { GuardianLinksService } from './guardian-links.service';
import { GuardianPortalService } from './guardian-portal.service';

class CreateGuardianDto extends createZodDto(createGuardianSchema) {}
/** Ids are checked by the service: an invalid id is a 404, like any child that is not yours. */
class PeriodQueryDto extends createZodDto(z.object({ periodId: z.string().min(1).max(64) })) {}
class OptionalPeriodQueryDto extends createZodDto(
  z.object({ periodId: z.string().min(1).max(64).optional() }),
) {}
class HistoryQueryDto extends createZodDto(
  z.object({ schoolYearId: z.string().min(1).max(64).optional() }),
) {}

/** Only the guardian's own links (a teacher's or director's GuardianLink rules do not count). */
const canUseGuardianPortal = (ability: AppAbility, request: AuthenticatedRequest) =>
  ability.can(
    'read',
    subject('GuardianLink', { guardianUserId: request.user.id, status: 'ACTIVE' }),
  );

function sendPdf(res: Response, buffer: Buffer, fileName: string, fallback: string): void {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
  );
  res.setHeader('Cache-Control', 'no-store');
  res.send(buffer);
}

@ApiTags('guardians')
@ApiBearerAuth()
@Controller()
export class GuardiansController {
  constructor(
    private readonly accounts: GuardianAccountsService,
    private readonly links: GuardianLinksService,
    private readonly portal: GuardianPortalService,
  ) {}

  // ---- guardian accounts (homeroom teacher, direction, admin) ---------------------
  @Post('students/:id/guardians')
  @CheckPolicies((ability) => ability.can('create', 'GuardianLink'))
  @ApiOperation({
    summary:
      'Crea la cuenta del padre o tutor (usuario TUT26-0001 + contraseña temporal). Si el teléfono ya está registrado, vincula al alumno con esa cuenta',
  })
  createGuardian(
    @Param('id', ObjectIdPipe) id: string,
    @Body() body: CreateGuardianDto,
    @CurrentActor() actor: Actor,
  ): Promise<CreatedAccountView> {
    return this.accounts.createForStudent(id, body, actor);
  }

  @Get('groups/:id/guardians')
  @CheckPolicies((ability) => ability.can('read', 'GuardianLink'))
  @ApiOperation({ summary: 'Padres de familia del grupo: tutores vinculados por alumno' })
  listForGroup(
    @Param('id', ObjectIdPipe) id: string,
    @CurrentActor() actor: Actor,
  ): Promise<GroupGuardianRow[]> {
    return this.accounts.listForGroup(id, actor);
  }

  @Post('guardians/:id/reset-password')
  @HttpCode(HttpStatus.OK)
  @CheckPolicies((ability) => ability.can('create', 'GuardianLink'))
  @ApiOperation({ summary: 'Nueva contraseña temporal para un padre o tutor' })
  resetGuardianPassword(
    @Param('id', ObjectIdPipe) id: string,
    @CurrentActor() actor: Actor,
  ): Promise<TemporaryPasswordView> {
    return this.accounts.resetPassword(id, actor);
  }

  @Get('students/:id/guardians')
  @CheckPolicies((ability) => ability.can('read', 'GuardianLink'))
  @ApiOperation({ summary: 'Tutores vinculados al alumno' })
  guardiansOf(
    @Param('id', ObjectIdPipe) id: string,
    @CurrentActor() actor: Actor,
  ): Promise<GuardianLinkView[]> {
    return this.links.forStudent(id, actor);
  }

  @Delete('guardian-links/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @CheckPolicies((ability) => ability.can('delete', 'GuardianLink'))
  @ApiOperation({ summary: 'Desvincula a un tutor (admin o dirección)' })
  revoke(@Param('id', ObjectIdPipe) id: string, @CurrentActor() actor: Actor): Promise<void> {
    return this.links.revoke(id, actor);
  }

  // ---- guardian portal -------------------------------------------------------------
  @Get('me/children')
  @CheckPolicies(canUseGuardianPortal)
  @ApiOperation({ summary: 'Mis hijos (padre o tutor)' })
  children(@CurrentActor() actor: Actor): Promise<ChildView[]> {
    return this.portal.children(actor);
  }

  @Get('me/children/:id/overview')
  @CheckPolicies(canUseGuardianPortal)
  @ApiOperation({ summary: 'Avance en curso por campo y evolución semanal' })
  overview(
    @Param('id') id: string,
    @Query() query: PeriodQueryDto,
    @CurrentActor() actor: Actor,
  ): Promise<ChildOverview> {
    return this.portal.overview(id, query.periodId, actor);
  }

  @Get('me/children/:id/activities')
  @CheckPolicies(canUseGuardianPortal)
  @ApiOperation({ summary: 'Actividades visibles con su calificación' })
  activities(
    @Param('id') id: string,
    @Query() query: PeriodQueryDto,
    @CurrentActor() actor: Actor,
  ): Promise<ChildActivity[]> {
    return this.portal.activities(id, query.periodId, actor);
  }

  @Get('me/children/:id/notes')
  @CheckPolicies(canUseGuardianPortal)
  @ApiOperation({ summary: 'Notas de la maestra visibles para la familia' })
  notes(
    @Param('id') id: string,
    @Query() query: OptionalPeriodQueryDto,
    @CurrentActor() actor: Actor,
  ): Promise<ChildNote[]> {
    return this.portal.notes(id, query.periodId, actor);
  }

  @Get('me/children/:id/history')
  @CheckPolicies(canUseGuardianPortal)
  @ApiOperation({ summary: 'Calificación por campo en cada periodo (?schoolYearId=)' })
  history(
    @Param('id') id: string,
    @Query() query: HistoryQueryDto,
    @CurrentActor() actor: Actor,
  ): Promise<StudentHistory> {
    return this.portal.history(id, query.schoolYearId, actor);
  }

  @Get('me/children/:id/report-cards')
  @CheckPolicies(canUseGuardianPortal)
  @ApiOperation({ summary: 'Boletas publicadas con la calificación final por campo' })
  reportCards(@Param('id') id: string, @CurrentActor() actor: Actor): Promise<ChildReportCard[]> {
    return this.portal.reportCards(id, actor);
  }

  @Get('me/children/:id/report-card.pdf')
  @CheckPolicies(canUseGuardianPortal)
  @ApiProduces('application/pdf')
  @ApiOperation({ summary: 'Boleta publicada en PDF' })
  async reportCardPdf(
    @Param('id') id: string,
    @Query() query: PeriodQueryDto,
    @CurrentActor() actor: Actor,
    @Res() res: Response,
  ): Promise<void> {
    const file = await this.portal.reportCardPdf(id, query.periodId, actor);
    sendPdf(res, file.buffer, file.fileName, 'boleta.pdf');
  }
}
