import { Module, RequestMethod } from '@nestjs/common';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { MongooseModule } from '@nestjs/mongoose';
import { LoggerModule } from 'nestjs-pino';
import { ZodValidationPipe } from 'nestjs-zod';
import { AccessModule } from './access/access.module';
import { ActivitiesModule } from './activities/activities.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { ClosingModule } from './closing/closing.module';
import { AllExceptionsFilter } from './common/all-exceptions.filter';
import { REDACTED_LOG_PATHS } from './common/scrub';
import { AppConfigService } from './config/app-config.service';
import { AppConfigModule } from './config/config.module';
import { ModelsModule } from './database/models.module';
import { FilesModule } from './files/files.module';
import { GroupsModule } from './groups/groups.module';
import { GuardiansModule } from './guardians/guardians.module';
import { HealthController } from './health/health.controller';
import { ImportsModule } from './imports/imports.module';
import { InvitationsModule } from './invitations/invitations.module';
import { MailModule } from './mail/mail.module';
import { NotesModule } from './notes/notes.module';
import { PeriodsModule } from './periods/periods.module';
import { PermissionGrantsModule } from './permission-grants/permission-grants.module';
import { ReportsModule } from './reports/reports.module';
import { SchoolYearsModule } from './school-years/school-years.module';
import { SchoolsModule } from './schools/schools.module';
import { StudentsModule } from './students/students.module';
import { SummaryModule } from './summary/summary.module';
import { UsersAdminModule } from './users/users-admin.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    AppConfigModule,
    LoggerModule.forRootAsync({
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        // Express 5 route syntax (the default '*' triggers a legacy-route warning).
        forRoutes: [{ path: '{*splat}', method: RequestMethod.ALL }],
        pinoHttp: {
          level: config.get('LOG_LEVEL'),
          // Logs carry ids only: never tokens, cookies, bodies or personal data.
          redact: {
            paths: REDACTED_LOG_PATHS,
            censor: '[oculto]',
          },
          serializers: {
            req: (req: { id: unknown; method: string; url: string }) => ({
              id: req.id,
              method: req.method,
              url: req.url.split('?')[0],
            }),
            res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
          },
          autoLogging: { ignore: (req) => req.url === '/api/v1/health' },
          ...(config.get('NODE_ENV') === 'development'
            ? { transport: { target: 'pino-pretty', options: { singleLine: true } } }
            : {}),
        },
      }),
    }),
    MongooseModule.forRootAsync({
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        uri: config.get('MONGODB_URI'),
        autoIndex: true,
      }),
    }),
    ModelsModule,
    FilesModule,
    PeriodsModule,
    AccessModule,
    AuditModule,
    SummaryModule,
    MailModule,
    SchoolsModule,
    UsersModule,
    InvitationsModule,
    AuthModule,
    UsersAdminModule,
    PermissionGrantsModule,
    SchoolYearsModule,
    GroupsModule,
    StudentsModule,
    ActivitiesModule,
    NotesModule,
    ClosingModule,
    ReportsModule,
    ImportsModule,
    GuardiansModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_PIPE, useClass: ZodValidationPipe },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
