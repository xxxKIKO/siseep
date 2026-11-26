import { z } from 'zod';

const booleanString = z
  .enum(['true', 'false', '1', '0'])
  .transform((value) => value === 'true' || value === '1');

/** Environment variables for the API. Validated at startup; the app refuses to boot if invalid. */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  MONGODB_URI: z.string().min(1),

  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET debe tener al menos 32 caracteres'),
  /** Access token lifetime in seconds (15 minutes by default). */
  JWT_ACCESS_TTL: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  COOKIE_SECURE: booleanString.default(true),

  /** Comma-separated list of origins allowed by CORS. */
  WEB_ORIGIN: z.string().default('http://localhost:5173'),
  /** Public URL of the web app, used to build links in emails. */
  WEB_URL: z.string().url().default('http://localhost:5173'),
  /** Express `trust proxy` setting: number of proxy hops in front of the API. */
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),
  SWAGGER_ENABLED: booleanString.default(true),

  THROTTLE_LOGIN_LIMIT: z.coerce.number().int().positive().default(5),
  THROTTLE_LOGIN_TTL_MS: z.coerce.number().int().positive().default(60_000),
  THROTTLE_LOGIN_BLOCK_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(15 * 60_000),

  INVITATION_TTL_DAYS: z.coerce.number().int().positive().default(7),
  /** Hours after creation before guardians can see an activity (time to fix mistakes). */
  ACTIVITY_GUARDIAN_DELAY_HOURS: z.coerce
    .number()
    .int()
    .min(0)
    .max(24 * 30)
    .default(24),

  /** Chrome/Chromium for PDFs. Empty: PUPPETEER_EXECUTABLE_PATH or auto-detect. */
  CHROMIUM_PATH: z.string().optional(),
  /** PDFs generated at the same time (Puppeteer is memory hungry). */
  PDF_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(2),
  PASSWORD_RESET_TTL_MINUTES: z.coerce.number().int().positive().default(60),

  MAIL_DRIVER: z.enum(['console', 'resend']).default('console'),
  MAIL_FROM: z.string().default('Evaluación Allende <no-responder@example.com>'),
  RESEND_API_KEY: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Validates the known variables and keeps any other keys (e.g. SEED_*), so scripts can read
 * them through ConfigService.
 */
export function validateEnv(config: Record<string, unknown>): Env {
  const result = envSchema.loose().safeParse(config);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Variables de entorno inválidas:\n${issues}`);
  }
  if (result.data.MAIL_DRIVER === 'resend' && !result.data.RESEND_API_KEY) {
    throw new Error(
      'Variables de entorno inválidas:\n  - RESEND_API_KEY es obligatoria con MAIL_DRIVER=resend',
    );
  }
  return result.data;
}
