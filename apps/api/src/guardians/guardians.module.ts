import { Module } from '@nestjs/common';
import { ClosingModule } from '../closing/closing.module';
import { GroupsModule } from '../groups/groups.module';
import { ReportsModule } from '../reports/reports.module';
import { UsersModule } from '../users/users.module';
import { GuardianInvitationsService } from './guardian-invitations.service';
import { GuardianLinksService } from './guardian-links.service';
import { GuardianPortalService } from './guardian-portal.service';
import { GuardiansController } from './guardians.controller';

/** Stage 5: guardian codes, links and the guardian portal (/me/children). */
@Module({
  imports: [GroupsModule, ReportsModule, UsersModule, ClosingModule],
  controllers: [GuardiansController],
  providers: [GuardianInvitationsService, GuardianLinksService, GuardianPortalService],
  exports: [GuardianInvitationsService],
})
export class GuardiansModule {}
