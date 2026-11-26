import { Module } from '@nestjs/common';
import { GroupsModule } from '../groups/groups.module';
import { ActivitiesController } from './activities.controller';
import { ActivitiesService } from './activities.service';
import { GradesService } from './grades.service';

@Module({
  imports: [GroupsModule],
  controllers: [ActivitiesController],
  providers: [ActivitiesService, GradesService],
  exports: [ActivitiesService],
})
export class ActivitiesModule {}
