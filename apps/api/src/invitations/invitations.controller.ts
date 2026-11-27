import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { subject } from '@siseep/shared';
import { CheckPolicies, CurrentUser } from '../common/decorators';
import type { RequestUser } from '../common/request-user';
import { CreateStaffInvitationDto } from './invitations.dto';
import { InvitationsService, type StaffInvitationView } from './invitations.service';

@ApiTags('invitations')
@ApiBearerAuth()
@Controller('invitations')
export class InvitationsController {
  constructor(private readonly invitations: InvitationsService) {}

  @Post('staff')
  @HttpCode(HttpStatus.CREATED)
  @CheckPolicies((ability) => ability.can('create', subject('Invitation', { type: 'STAFF' })))
  @ApiOperation({ summary: 'Invita a una persona del personal (solo admin)' })
  createStaff(
    @Body() dto: CreateStaffInvitationDto,
    @CurrentUser() user: RequestUser,
  ): Promise<StaffInvitationView> {
    return this.invitations.createStaff(dto, user);
  }

  @Get()
  @CheckPolicies((ability) => ability.can('read', subject('Invitation', { type: 'STAFF' })))
  @ApiOperation({ summary: 'Invitaciones de personal pendientes (solo admin)' })
  listPending(@CurrentUser() user: RequestUser): Promise<StaffInvitationView[]> {
    return this.invitations.listPendingStaff(user);
  }
}
