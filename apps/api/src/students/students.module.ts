import { Module } from '@nestjs/common';
import { EnrollmentsController, StudentsController } from './students.controller';
import { StudentsService } from './students.service';

@Module({
  controllers: [StudentsController, EnrollmentsController],
  providers: [StudentsService],
  exports: [StudentsService],
})
export class StudentsModule {}
