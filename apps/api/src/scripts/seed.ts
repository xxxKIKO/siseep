import 'reflect-metadata';
import { Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { MongooseModule } from '@nestjs/mongoose';
import { emailSchema, passwordSchema, Role } from '@siseep/shared';
import { z } from 'zod';
import { PasswordService } from '../auth/password.service';
import { AppConfigService } from '../config/app-config.service';
import { AppConfigModule } from '../config/config.module';
import { SchoolsModule } from '../schools/schools.module';
import { SchoolsService } from '../schools/schools.service';
import { UsersModule } from '../users/users.module';
import { UsersService } from '../users/users.service';

/**
 * Idempotent seed: `pnpm seed`. Creates or updates the school and the three initial accounts.
 * Passwords come from .env and are only set when an account is created, so running it again
 * never overwrites a password someone already changed.
 */
@Module({
  imports: [
    AppConfigModule,
    MongooseModule.forRootAsync({
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({ uri: config.get('MONGODB_URI') }),
    }),
    SchoolsModule,
    UsersModule,
  ],
  providers: [PasswordService],
})
class SeedModule {}

const seedEnvSchema = z.object({
  SEED_ADMIN_EMAIL: emailSchema,
  SEED_ADMIN_PASSWORD: passwordSchema,
  SEED_DIRECTOR_EMAIL: emailSchema,
  SEED_DIRECTOR_PASSWORD: passwordSchema,
  SEED_DIRECTOR_FIRST_NAME: z.string().trim().min(1).default('Directora'),
  SEED_DIRECTOR_LAST_NAME: z.string().trim().default(''),
  SEED_TEACHER_EMAIL: emailSchema,
  SEED_TEACHER_PASSWORD: passwordSchema,
});

export const SEED_SCHOOL = {
  name: 'Esc. Prim. Fed. Dr. Salvador Allende T.M.',
  shortName: 'Salvador Allende',
  city: 'Colima',
  state: 'Colima',
};

async function main(): Promise<void> {
  const logger = new Logger('Seed');
  const app = await NestFactory.createApplicationContext(SeedModule, {
    logger: ['error', 'warn', 'log'],
  });

  try {
    // ConfigService reads process.env and the .env file loaded by AppConfigModule.
    const config = app.get(ConfigService);
    const raw = Object.fromEntries(
      Object.keys(seedEnvSchema.shape).map((key) => [key, config.get<string>(key)]),
    );
    const parsed = seedEnvSchema.safeParse(raw);
    if (!parsed.success) {
      const issues = parsed.error.issues
        .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
        .join('\n');
      throw new Error(`Faltan variables para el seed:\n${issues}`);
    }
    const env = parsed.data;

    const schools = app.get(SchoolsService);
    const users = app.get(UsersService);
    const passwords = app.get(PasswordService);
    await passwords.onModuleInit();

    const school = await schools.upsertByName(SEED_SCHOOL);
    logger.log(`Escuela lista: ${school.name} (${school._id.toString()})`);

    const accounts = [
      {
        label: 'Admin',
        email: env.SEED_ADMIN_EMAIL,
        password: env.SEED_ADMIN_PASSWORD,
        firstName: 'Administración',
        lastName: '',
        roles: [Role.ADMIN],
      },
      {
        label: 'Directora',
        email: env.SEED_DIRECTOR_EMAIL,
        password: env.SEED_DIRECTOR_PASSWORD,
        firstName: env.SEED_DIRECTOR_FIRST_NAME,
        lastName: env.SEED_DIRECTOR_LAST_NAME,
        roles: [Role.DIRECTOR],
      },
      {
        label: 'Maestra',
        email: env.SEED_TEACHER_EMAIL,
        password: env.SEED_TEACHER_PASSWORD,
        firstName: 'Mtra. Viry',
        lastName: '',
        roles: [Role.TEACHER],
      },
    ];

    for (const account of accounts) {
      const { created } = await users.upsertSeedUser({
        schoolId: school._id,
        email: account.email,
        passwordHash: await passwords.hash(account.password),
        firstName: account.firstName,
        lastName: account.lastName,
        roles: account.roles,
      });
      logger.log(`${account.label}: ${created ? 'creada' : 'ya existía (contraseña sin cambios)'}`);
    }
    logger.log('Seed terminado.');
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
