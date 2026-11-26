import { HttpException, HttpStatus } from '@nestjs/common';
import { ErrorCode } from '@siseep/shared';

/** HTTP error with a stable machine code and a Spanish message for the user. */
export class AppException extends HttpException {
  constructor(
    status: HttpStatus,
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super({ code, message, details }, status);
  }
}

export const Errors = {
  invalidCredentials: () =>
    new AppException(
      HttpStatus.UNAUTHORIZED,
      ErrorCode.INVALID_CREDENTIALS,
      'Correo o contraseña incorrectos.',
    ),
  accountDisabled: () =>
    new AppException(
      HttpStatus.FORBIDDEN,
      ErrorCode.ACCOUNT_DISABLED,
      'Tu cuenta está desactivada. Comunícate con la dirección de la escuela.',
    ),
  unauthorized: (message = 'Inicia sesión para continuar.') =>
    new AppException(HttpStatus.UNAUTHORIZED, ErrorCode.UNAUTHORIZED, message),
  invalidRefreshToken: () =>
    new AppException(
      HttpStatus.UNAUTHORIZED,
      ErrorCode.INVALID_REFRESH_TOKEN,
      'Tu sesión terminó. Vuelve a iniciar sesión.',
    ),
  refreshTokenReused: () =>
    new AppException(
      HttpStatus.UNAUTHORIZED,
      ErrorCode.REFRESH_TOKEN_REUSED,
      'Por seguridad cerramos todas tus sesiones. Vuelve a iniciar sesión.',
    ),
  invalidResetToken: () =>
    new AppException(
      HttpStatus.BAD_REQUEST,
      ErrorCode.INVALID_TOKEN,
      'El enlace para restablecer la contraseña no es válido o ya venció.',
    ),
  invalidInvitation: () =>
    new AppException(
      HttpStatus.BAD_REQUEST,
      ErrorCode.INVALID_INVITATION,
      'La invitación no es válida, ya se usó o ya venció.',
    ),
  forbidden: () =>
    new AppException(
      HttpStatus.FORBIDDEN,
      ErrorCode.FORBIDDEN,
      'No tienes permiso para realizar esta acción.',
    ),
  conflict: (message: string, details?: unknown) =>
    new AppException(HttpStatus.CONFLICT, ErrorCode.CONFLICT, message, details),
  notFound: (message = 'No encontramos lo que buscas.') =>
    new AppException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, message),
  badRequest: (message: string, details?: unknown) =>
    new AppException(HttpStatus.BAD_REQUEST, ErrorCode.BAD_REQUEST, message, details),
  invalidFile: (message: string) =>
    new AppException(HttpStatus.BAD_REQUEST, ErrorCode.INVALID_FILE, message),
  periodNotOpen: () =>
    new AppException(
      HttpStatus.CONFLICT,
      ErrorCode.PERIOD_NOT_OPEN,
      'El periodo no está abierto: ya no se pueden cambiar sus actividades.',
    ),
};
