import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { getConnectionToken } from '@nestjs/mongoose';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Connection } from 'mongoose';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { AppConfigService } from './config/app-config.service';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  const logger = app.get(Logger);
  app.useLogger(logger);
  configureApp(app);

  const config = app.get(AppConfigService);
  const port = config.get('PORT');
  try {
    await app.listen(port, '0.0.0.0');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EADDRINUSE') {
      logger.error(
        `El puerto ${port} ya está en uso (¿otro proyecto?). Cambia PORT en .env o detén lo que lo usa.`,
      );
      process.exit(1);
    }
    throw error;
  }
  logger.log(`API lista en http://localhost:${port}/api/v1 (docs en /api/docs)`);
  await warnIfStandalone(app, logger, config.isProductionLike);
}

/** Transactions (closing periods, Excel import) need a replica set. Atlas always is one. */
async function warnIfStandalone(
  app: NestExpressApplication,
  logger: Logger,
  isProductionLike: boolean,
): Promise<void> {
  try {
    const connection = app.get<Connection>(getConnectionToken());
    const hello = await connection.db!.admin().command({ hello: 1 });
    if (hello.setName) return;
    const message =
      'MongoDB es standalone: las transacciones no están disponibles. Usa un replica set ' +
      '(Atlas en staging/producción) antes de las etapas que las requieren.';
    if (isProductionLike) logger.error(message);
    else logger.warn(message);
  } catch {
    // Not critical: the health check reports database problems.
  }
}

void bootstrap();
