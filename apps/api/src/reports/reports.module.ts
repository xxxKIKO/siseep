import { Module } from '@nestjs/common';
import { ActivitiesModule } from '../activities/activities.module';
import { GroupsModule } from '../groups/groups.module';
import { PdfService } from './pdf.service';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({
  imports: [GroupsModule, ActivitiesModule],
  controllers: [ReportsController],
  providers: [PdfService, ReportsService],
  exports: [PdfService],
})
export class ReportsModule {}
