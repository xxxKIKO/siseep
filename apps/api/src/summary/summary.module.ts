import { Global, Module } from '@nestjs/common';
import { GroupsModule } from '../groups/groups.module';
import { SummaryCache } from './summary-cache.service';
import { SummaryController } from './summary.controller';
import { SummaryService } from './summary.service';

/** Global so that grades, activities and imports can invalidate the cache. */
@Global()
@Module({
  imports: [GroupsModule],
  controllers: [SummaryController],
  providers: [SummaryService, SummaryCache],
  exports: [SummaryCache],
})
export class SummaryModule {}
