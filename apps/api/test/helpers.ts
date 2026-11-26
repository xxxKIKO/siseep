import type { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import type { Role } from '@siseep/shared';
import type { Connection } from 'mongoose';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { REFRESH_COOKIE } from '../src/auth/auth.controller';
import { PasswordService } from '../src/auth/password.service';
import { type MailMessage, MailService } from '../src/mail/mail.service';
import { SchoolsService } from '../src/schools/schools.service';
import { UsersService } from '../src/users/users.service';

/** Captures emails instead of sending them. */
export class FakeMailService extends MailService {
  readonly sent: MailMessage[] = [];

  async send(message: MailMessage): Promise<void> {
    this.sent.push(message);
  }

  lastTo(email: string): MailMessage | undefined {
    return [...this.sent].reverse().find((message) => message.to === email);
  }
}

export interface TestContext {
  app: INestApplication;
  mail: FakeMailService;
  connection: Connection;
  http: () => ReturnType<typeof request>;
  createUser: (roles: Role[], password?: string) => Promise<TestUser>;
  close: () => Promise<void>;
}

export interface TestUser {
  id: string;
  email: string;
  password: string;
  schoolId: string;
}

export const DEFAULT_PASSWORD = 'contraseña-segura-1';
let userCounter = 0;

/** Boots the real AppModule against this test file's own database (see setup-env.ts). */
export async function createTestContext(): Promise<TestContext> {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is not set (see test/setup-env.ts)');

  const mail = new FakeMailService();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(MailService)
    .useValue(mail)
    .compile();
  const app = moduleRef.createNestApplication({ logger: false });
  configureApp(app);
  await app.init();

  const connection = app.get<Connection>(getConnectionToken());
  await connection.dropDatabase();
  await connection.syncIndexes();

  const school = await app.get(SchoolsService).upsertByName({ name: 'Escuela de prueba' });
  const passwords = app.get(PasswordService);
  const users = app.get(UsersService);

  return {
    app,
    mail,
    connection,
    http: () => request(app.getHttpServer()),
    async createUser(roles, password = DEFAULT_PASSWORD) {
      userCounter += 1;
      const email = `usuario${userCounter}-${roles.join('-').toLowerCase()}@prueba.mx`;
      const user = await users.create({
        schoolId: school._id,
        email,
        passwordHash: await passwords.hash(password),
        firstName: 'Persona',
        lastName: `Prueba ${userCounter}`,
        roles,
      });
      return { id: user._id.toString(), email, password, schoolId: school._id.toString() };
    },
    async close() {
      await connection.dropDatabase();
      await app.close();
    },
  };
}

/** Extracts the refresh cookie (`name=value`) from a response, or undefined. */
export function refreshCookieFrom(res: request.Response): string | undefined {
  const header = res.headers['set-cookie'] as unknown as string[] | undefined;
  const cookie = header?.find((value) => value.startsWith(`${REFRESH_COOKIE}=`));
  return cookie?.split(';')[0];
}

export function rawSetCookie(res: request.Response): string | undefined {
  const header = res.headers['set-cookie'] as unknown as string[] | undefined;
  return header?.find((value) => value.startsWith(`${REFRESH_COOKIE}=`));
}
