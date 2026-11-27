import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ClosingModule } from '../closing/closing.module';
import { GroupsModule } from '../groups/groups.module';
import { ReportsModule } from '../reports/reports.module';
import { UsersModule } from '../users/users.module';
import { GuardianAccountsService } from './guardian-accounts.service';
import { GuardianLinksService } from './guardian-links.service';
import { GuardianPortalService } from './guardian-portal.service';
import { GuardiansController } from './guardians.controller';

/** Guardian accounts created by the school, their links and the guardian portal. */
@Module({
  imports: [GroupsModule, ReportsModule, UsersModule, ClosingModule, AuthModule],
  controllers: [GuardiansController],
  providers: [GuardianAccountsService, GuardianLinksService, GuardianPortalService],
})
export class GuardiansModule {}
