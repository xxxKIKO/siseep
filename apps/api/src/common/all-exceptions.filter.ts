import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { type ApiError, ErrorCode } from '@siseep/shared';
import type { Response } from 'express';
import { ThrottlerException } from '@nestjs/throttler';
import { ZodValidationException } from 'nestjs-zod';
import { ZodError } from 'zod';
import { AppException } from './app.exception';

const DEFAULTS: Record<number, { code: ErrorCode; message: string }> = {
  400: { code: ErrorCode.BAD_REQUEST, message: 'La solicitud no es válida.' },
  401: { code: ErrorCode.UNAUTHORIZED, message: 'Inicia sesión para continuar.' },
  403: { code: ErrorCode.FORBIDDEN, message: 'No tienes permiso para realizar esta acción.' },
  404: { code: ErrorCode.NOT_FOUND, message: 'No encontramos lo que buscas.' },
  409: {
    code: ErrorCode.CONFLICT,
    message: 'El registro ya existe o cambió mientras lo editabas.',
  },
  429: {
    code: ErrorCode.TOO_MANY_REQUESTS,
    message: 'Demasiados intentos. Espera unos minutos y vuelve a intentarlo.',
  },
  500: {
    code: ErrorCode.INTERNAL_ERROR,
    message: 'Ocurrió un error inesperado. Intenta de nuevo.',
  },
};

/**
 * Global error filter. Every error leaves the API as `{ statusCode, code, message, details? }`
 * with a Spanish message. Internal details are logged, never sent to the client.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Errors');

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const body = this.toBody(exception);
    if (body.statusCode >= 500) {
      this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    }
    response.status(body.statusCode).json(body);
  }

  private toBody(exception: unknown): ApiError {
    if (exception instanceof ZodValidationException) {
      const zodError = exception.getZodError();
      const issues =
        zodError instanceof ZodError
          ? zodError.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }))
          : undefined;
      return {
        statusCode: HttpStatus.BAD_REQUEST,
        code: ErrorCode.VALIDATION_ERROR,
        message: 'Revisa los datos marcados.',
        details: issues,
      };
    }

    if (exception instanceof AppException) {
      const statusCode = exception.getStatus();
      return {
        statusCode,
        code: exception.code,
        message: exception.message,
        ...(exception.details === undefined ? {} : { details: exception.details }),
      };
    }

    if (exception instanceof ThrottlerException) {
      return { statusCode: HttpStatus.TOO_MANY_REQUESTS, ...DEFAULTS[429]! };
    }

    if (exception instanceof HttpException) {
      const statusCode = exception.getStatus();
      const fallback =
        DEFAULTS[statusCode] ?? (statusCode >= 500 ? DEFAULTS[500]! : DEFAULTS[400]!);
      return { statusCode, ...fallback };
    }

    if (isMongoDuplicateKey(exception)) {
      return { statusCode: HttpStatus.CONFLICT, ...DEFAULTS[409]! };
    }

    return { statusCode: HttpStatus.INTERNAL_SERVER_ERROR, ...DEFAULTS[500]! };
  }
}

function isMongoDuplicateKey(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 11000
  );
}
