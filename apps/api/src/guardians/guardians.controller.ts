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
  createGuardianInvitationSchema,
  type GroupGuardianRow,
  type GuardianInvitationView,
  type GuardianLinkView,
  printGuardianCodesSchema,
  redeemGuardianCodeSchema,
} from '@siseep/shared';
import type { Response } from 'express';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { CheckPolicies, CurrentActor } from '../common/decorators';
import { ObjectIdPipe } from '../common/object-id.pipe';
import type { Actor } from '../common/request-user';
import { UsersService } from '../users/users.service';
import { GuardianInvitationsService } from './guardian-invitations.service';
import { GuardianLinksService } from './guardian-links.service';
import { GuardianPortalService } from './guardian-portal.service';

class CreateGuardianInvitationDto extends createZodDto(createGuardianInvitationSchema) {}
class PrintCodesDto extends createZodDto(printGuardianCodesSchema) {}
class RedeemDto extends createZodDto(redeemGuardianCodeSchema) {}
/** Ids are checked by the service: an invalid id is a 404, like any child that is not yours. */
class PeriodQueryDto extends createZodDto(z.object({ periodId: z.string().min(1).max(64) })) {}
class OptionalPeriodQueryDto extends createZodDto(
  z.object({ periodId: z.string().min(1).max(64).optional() }),
) {}

const canUseGuardianPortal = (ability: AppAbility) => ability.can('read', 'GuardianLink');

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
    private readonly invitations: GuardianInvitationsService,
    private readonly links: GuardianLinksService,
    private readonly portal: GuardianPortalService,
    private readonly users: UsersService,
  ) {}

  // ---- codes (homeroom teacher or admin) ------------------------------------------
  @Post('invitations/guardian')
  @CheckPolicies((ability) => ability.can('create', 'Invitation'))
  @ApiOperation({ summary: 'Genera un código para padres (8 caracteres, 14 días, un uso)' })
  create(
    @Body() body: CreateGuardianInvitationDto,
    @CurrentActor() actor: Actor,
  ): Promise<GuardianInvitationView> {
    return this.invitations.create(body.studentId, body.relationship, actor);
  }

  @Get('groups/:id/guardian-invitations')
  @CheckPolicies((ability) => ability.can('read', 'Invitation'))
  @ApiOperation({ summary: 'Padres de familia del grupo: vinculado, pendiente o sin código' })
  listForGroup(
    @Param('id', ObjectIdPipe) id: string,
    @CurrentActor() actor: Actor,
  ): Promise<GroupGuardianRow[]> {
    return this.invitations.listForGroup(id, actor);
  }

  @Post('groups/:id/guardian-codes.pdf')
  @HttpCode(HttpStatus.OK)
  @CheckPolicies((ability) => ability.can('create', 'Invitation'))
  @ApiProduces('application/pdf')
  @ApiOperation({
    summary: 'Tiras recortables con códigos nuevos (por defecto, alumnos sin tutor vinculado)',
  })
  async print(
    @Param('id', ObjectIdPipe) id: string,
    @Body() body: PrintCodesDto,
    @CurrentActor() actor: Actor,
    @Res() res: Response,
  ): Promise<void> {
    const { pdf, fileName, count } = await this.invitations.printStrips(id, body.studentIds, actor);
    res.setHeader('X-Codes-Count', String(count));
    sendPdf(res, pdf, fileName, 'codigos-padres.pdf');
  }

  // ---- admin: guardians of a student ---------------------------------------------
  @Get('students/:id/guardians')
  @CheckPolicies((ability) => ability.can('delete', 'GuardianLink'))
  @ApiOperation({ summary: 'Tutores vinculados al alumno (admin)' })
  guardiansOf(
    @Param('id', ObjectIdPipe) id: string,
    @CurrentActor() actor: Actor,
  ): Promise<GuardianLinkView[]> {
    return this.links.forStudent(id, actor);
  }

  @Delete('guardian-links/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @CheckPolicies((ability) => ability.can('delete', 'GuardianLink'))
  @ApiOperation({ summary: 'Desvincula a un tutor (admin)' })
  revoke(@Param('id', ObjectIdPipe) id: string, @CurrentActor() actor: Actor): Promise<void> {
    return this.links.revoke(id, actor);
  }

  // ---- guardian portal -------------------------------------------------------------
  @Post('me/children')
  @ApiOperation({ summary: 'Canjea otro código ("Agregar hijo")' })
  async redeem(@Body() body: RedeemDto, @CurrentActor() actor: Actor): Promise<ChildView[]> {
    const user = await this.users.findById(actor.user.id);
    if (!user) throw new Error('User not found');
    await this.invitations.redeem(user, body.code, body.relationship, {
      acceptPrivacy: body.acceptPrivacy,
      ip: actor.ip,
    });
    return this.portal.children(actor);
  }

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
