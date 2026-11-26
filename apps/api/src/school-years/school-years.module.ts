import { Module } from '@nestjs/common';
import { PeriodsController, SchoolYearsController } from './school-years.controller';
import { SchoolYearsService } from './school-years.service';

/** School years, periods and grading schemes (they always change together). */
@Module({
  controllers: [SchoolYearsController, PeriodsController],
  providers: [SchoolYearsService],
  exports: [SchoolYearsService],
})
export class SchoolYearsModule {}
