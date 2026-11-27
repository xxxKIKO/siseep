import { Module } from '@nestjs/common';
import { GroupsModule } from '../groups/groups.module';
import { NotesModule } from '../notes/notes.module';
import { ClosingController } from './closing.controller';
import { ClosingService } from './closing.service';
import { HistoryService } from './history.service';
import { PeriodResultsService } from './period-results.service';

/** Stage 4: period status per group, adjustments/observations and the closing snapshot. */
@Module({
  imports: [GroupsModule, NotesModule],
  controllers: [ClosingController],
  providers: [ClosingService, PeriodResultsService, HistoryService],
  exports: [PeriodResultsService, HistoryService],
})
export class ClosingModule {}
