import { z } from 'zod';

export const ErrorCode = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  BAD_REQUEST: 'BAD_REQUEST',
  UNAUTHORIZED: 'UNAUTHORIZED',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  ACCOUNT_DISABLED: 'ACCOUNT_DISABLED',
  INVALID_REFRESH_TOKEN: 'INVALID_REFRESH_TOKEN',
  REFRESH_TOKEN_REUSED: 'REFRESH_TOKEN_REUSED',
  INVALID_TOKEN: 'INVALID_TOKEN',
  INVALID_INVITATION: 'INVALID_INVITATION',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  INVALID_FILE: 'INVALID_FILE',
  IMPORT_BLOCKED: 'IMPORT_BLOCKED',
  IMPORT_EXPIRED: 'IMPORT_EXPIRED',
  PERIOD_NOT_OPEN: 'PERIOD_NOT_OPEN',
  GRADE_CONFLICT: 'GRADE_CONFLICT',
  ACTIVITY_HAS_GRADES: 'ACTIVITY_HAS_GRADES',
  INVALID_STUDENTS: 'INVALID_STUDENTS',
  TOO_MANY_REQUESTS: 'TOO_MANY_REQUESTS',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

/** Body of every error response from the API. Messages are in Spanish. */
export const apiErrorSchema = z.object({
  statusCode: z.number().int(),
  code: z.string(),
  message: z.string(),
  details: z.unknown().optional(),
});
export type ApiError = z.infer<typeof apiErrorSchema>;
