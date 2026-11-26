import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Activity, ActivitySchema } from '../activities/activity.schema';
import { Grade, GradeSchema } from '../activities/grade.schema';
import { GradingScheme, GradingSchemeSchema } from '../grading-schemes/grading-scheme.schema';
import { Group, GroupSchema } from '../groups/group.schema';
import { TeachingAssignment, TeachingAssignmentSchema } from '../groups/teaching-assignment.schema';
import { ImportPreviewRecord, ImportPreviewSchema } from '../imports/import-preview.schema';
import { PeriodResult, PeriodResultSchema } from '../period-results/period-result.schema';
import { Period, PeriodSchema } from '../periods/period.schema';
import {
  PermissionGrant,
  PermissionGrantSchema,
} from '../permission-grants/permission-grant.schema';
import { SchoolYear, SchoolYearSchema } from '../school-years/school-year.schema';
import { School, SchoolSchema } from '../schools/school.schema';
import { Enrollment, EnrollmentSchema } from '../students/enrollment.schema';
import { Student, StudentSchema } from '../students/student.schema';
import { User, UserSchema } from '../users/user.schema';

const models = MongooseModule.forFeature([
  { name: School.name, schema: SchoolSchema },
  { name: User.name, schema: UserSchema },
  { name: SchoolYear.name, schema: SchoolYearSchema },
  { name: Period.name, schema: PeriodSchema },
  { name: GradingScheme.name, schema: GradingSchemeSchema },
  { name: Group.name, schema: GroupSchema },
  { name: TeachingAssignment.name, schema: TeachingAssignmentSchema },
  { name: Student.name, schema: StudentSchema },
  { name: Enrollment.name, schema: EnrollmentSchema },
  { name: Activity.name, schema: ActivitySchema },
  { name: Grade.name, schema: GradeSchema },
  { name: PeriodResult.name, schema: PeriodResultSchema },
  { name: PermissionGrant.name, schema: PermissionGrantSchema },
  { name: ImportPreviewRecord.name, schema: ImportPreviewSchema },
]);

/** Registers every domain model once so any service can inject the models it needs. */
@Global()
@Module({ imports: [models], exports: [models] })
export class ModelsModule {}
