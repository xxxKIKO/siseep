import { Global, Module } from '@nestjs/common';
import { PeriodStatusService } from './period-status.service';

/** Global: activities, grades, notes, imports, groups and closing all ask the same service. */
@Global()
@Module({ providers: [PeriodStatusService], exports: [PeriodStatusService] })
export class PeriodsModule {}
