import { Module } from '@nestjs/common';
import { ActivitiesModule } from '../activities/activities.module';
import { ClosingModule } from '../closing/closing.module';
import { GroupsModule } from '../groups/groups.module';
import { PdfService } from './pdf.service';
import { PeriodExcelService } from './period-excel.service';
import { ReportsController } from './reports.controller';
import { ReportCardsService } from './report-cards.service';
import { ReportsService } from './reports.service';

@Module({
  imports: [GroupsModule, ActivitiesModule, ClosingModule],
  controllers: [ReportsController],
  providers: [PdfService, ReportsService, ReportCardsService, PeriodExcelService],
  exports: [PdfService, ReportCardsService],
})
export class ReportsModule {}
