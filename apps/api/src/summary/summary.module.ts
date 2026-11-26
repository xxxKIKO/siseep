import { Global, Module } from '@nestjs/common';
import { GroupsModule } from '../groups/groups.module';
import { PeriodDataService } from './period-data.service';
import { SummaryCache } from './summary-cache.service';
import { SummaryController } from './summary.controller';
import { SummaryService } from './summary.service';

/** Global so that grades, activities and imports can invalidate the cache (and closing reuses the data loader). */
@Global()
@Module({
  imports: [GroupsModule],
  controllers: [SummaryController],
  providers: [SummaryService, SummaryCache, PeriodDataService],
  exports: [SummaryCache, PeriodDataService],
})
export class SummaryModule {}
