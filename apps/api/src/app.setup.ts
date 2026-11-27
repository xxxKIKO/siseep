import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { cleanupOpenApiDoc } from 'nestjs-zod';
import { AppConfigService } from './config/app-config.service';

export const API_PREFIX = 'api/v1';

/** HTTP setup shared by main.ts and the e2e tests, so tests exercise the real configuration. */
export function configureApp(app: INestApplication): void {
  const config = app.get(AppConfigService);
  const express = app as NestExpressApplication;

  express.set('trust proxy', config.get('TRUST_PROXY'));
  express.disable('x-powered-by');
  app.setGlobalPrefix(API_PREFIX);
  // The API only serves JSON, PDF, Word and images: nothing may run or be framed. Swagger UI
  // (development only) needs scripts, so it keeps helmet's default policy.
  app.use(
    config.get('SWAGGER_ENABLED')
      ? helmet()
      : helmet({
          contentSecurityPolicy: {
            useDefaults: false,
            directives: {
              defaultSrc: ["'none'"],
              frameAncestors: ["'none'"],
              baseUri: ["'none'"],
              formAction: ["'none'"],
            },
          },
          crossOriginResourcePolicy: { policy: 'same-site' },
          strictTransportSecurity: { maxAge: 31_536_000, includeSubDomains: true },
        }),
  );
  app.use(
    (_req: unknown, res: { setHeader(name: string, value: string): void }, next: () => void) => {
      res.setHeader('X-Robots-Tag', 'noindex, nofollow');
      next();
    },
  );
  app.use(cookieParser());
  app.enableCors({ origin: config.webOrigins, credentials: true });
  app.enableShutdownHooks();

  if (config.get('SWAGGER_ENABLED')) {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('Sistema de Evaluación Escolar — API')
        .setDescription(
          'API REST v1. Las respuestas de error tienen la forma { statusCode, code, message, details? }.',
        )
        .setVersion('1.0')
        .addBearerAuth()
        .addCookieAuth('siseep_rt')
        .build(),
    );
    SwaggerModule.setup('api/docs', app, cleanupOpenApiDoc(document));
  }
}
