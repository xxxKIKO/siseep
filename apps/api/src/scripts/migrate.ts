import 'reflect-metadata';
import { Logger, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { getConnectionToken, MongooseModule } from '@nestjs/mongoose';
import { DEFAULT_GRADING_SCHEME, dateOnlyToDate } from '@siseep/shared';
import type { Connection } from 'mongoose';
import { AppConfigService } from '../config/app-config.service';
import { AppConfigModule } from '../config/config.module';
import { ModelsModule } from '../database/models.module';
import { Session, SessionSchema } from '../auth/session.schema';
import { PasswordReset, PasswordResetSchema } from '../auth/password-reset.schema';
import { SEED_SCHOOL } from './seed';

/**
 * `pnpm migrate:prod` — idempotent production migration:
 * 1. Creates every index declared in the schemas (never drops; extra indexes are only reported).
 * 2. Makes sure the school exists and has the 2026-2027 school year with its grading scheme
 *    (the rules of section 5, the same DEFAULT_GRADING_SCHEME the golden tests check).
 * Safe to run on every deploy.
 */
@Module({
  imports: [
    AppConfigModule,
    MongooseModule.forRootAsync({
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        uri: config.get('MONGODB_URI'),
        autoIndex: false,
      }),
    }),
    ModelsModule,
    MongooseModule.forFeature([
      { name: Session.name, schema: SessionSchema },
      { name: PasswordReset.name, schema: PasswordResetSchema },
    ]),
  ],
})
class MigrateModule {}

export const SCHOOL_YEAR_2026 = {
  name: '2026-2027',
  startDate: '2026-08-31',
  endDate: '2027-07-16',
};

export async function migrate(connection: Connection, logger: Pick<Logger, 'log' | 'warn'>) {
  // 1. Indexes.
  for (const model of Object.values(connection.models)) {
    await model.createIndexes();
    const diff = await model.diffIndexes();
    logger.log(`Índices de ${model.collection.collectionName}: listos`);
    if (diff.toDrop.length) {
      logger.warn(
        `  ${model.collection.collectionName} tiene índices que ya no se usan: ${diff.toDrop.join(', ')} (no se borran solos)`,
      );
    }
  }

  // 2. School, 2026-2027 and its grading scheme.
  const schools = connection.collection('schools');
  const now = new Date();
  await schools.updateOne(
    { name: SEED_SCHOOL.name },
    {
      $setOnInsert: {
        ...SEED_SCHOOL,
        teacherCanClosePeriod: false,
        privacyNoticeText: null,
        privacyNoticeVersion: 1,
        privacyNoticeUpdatedAt: null,
        deletedAt: null,
        createdAt: now,
        updatedAt: now,
      },
    },
    { upsert: true },
  );
  const school = (await schools.findOne({ name: SEED_SCHOOL.name }))!;

  const years = connection.collection('schoolYears');
  const hasCurrent = await years.countDocuments({ schoolId: school._id, isCurrent: true });
  await years.updateOne(
    { schoolId: school._id, name: SCHOOL_YEAR_2026.name },
    {
      $setOnInsert: {
        schoolId: school._id,
        name: SCHOOL_YEAR_2026.name,
        startDate: dateOnlyToDate(SCHOOL_YEAR_2026.startDate),
        endDate: dateOnlyToDate(SCHOOL_YEAR_2026.endDate),
        isCurrent: hasCurrent === 0,
        createdAt: now,
        updatedAt: now,
      },
    },
    { upsert: true },
  );
  const year = (await years.findOne({ schoolId: school._id, name: SCHOOL_YEAR_2026.name }))!;

  const schemes = connection.collection('gradingSchemes');
  const result = await schemes.updateOne(
    { schoolYearId: year._id },
    {
      $setOnInsert: {
        schoolId: school._id,
        schoolYearId: year._id,
        ...DEFAULT_GRADING_SCHEME,
        createdAt: now,
        updatedAt: now,
      },
    },
    { upsert: true },
  );
  logger.log(
    `Ciclo ${SCHOOL_YEAR_2026.name}: ${result.upsertedCount ? 'reglas de cálculo creadas' : 'reglas de cálculo ya existían (sin cambios)'}`,
  );
  return { schoolId: school._id.toString(), schoolYearId: year._id.toString() };
}

async function main(): Promise<void> {
  const logger = new Logger('Migrate');
  const app = await NestFactory.createApplicationContext(MigrateModule, {
    logger: ['error', 'warn', 'log'],
  });
  try {
    await migrate(app.get<Connection>(getConnectionToken()), logger);
    logger.log('Migración terminada.');
  } finally {
    await app.close();
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
