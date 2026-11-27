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
  /** Seconds the previous refresh secret stays valid after a rotation (lost responses). */
  REFRESH_REUSE_GRACE_SECONDS: z.coerce.number().int().min(0).max(300).default(60),
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

  /** Error monitoring (optional). Never sends personal data (sendDefaultPii: false). */
  SENTRY_DSN: z.string().url().optional().or(z.literal('')),
  SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0),
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
  const problems = productionProblems(result.data);
  if (problems.length) {
    throw new Error(`Variables de entorno inválidas para producción:\n${problems.join('\n')}`);
  }
  return result.data;
}

/** Staging/production refuse to boot with development-only settings. */
export function productionProblems(env: Env): string[] {
  if (env.NODE_ENV !== 'production' && env.NODE_ENV !== 'staging') return [];
  const problems: string[] = [];
  if (!env.COOKIE_SECURE) problems.push('  - COOKIE_SECURE debe ser true (cookies solo por HTTPS)');
  const origins = env.WEB_ORIGIN.split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  if (origins.some((o) => !o.startsWith('https://') || /localhost|127\.0\.0\.1/.test(o))) {
    problems.push('  - WEB_ORIGIN debe ser solo el dominio de la web con https:// (sin localhost)');
  }
  if (!env.WEB_URL.startsWith('https://')) problems.push('  - WEB_URL debe usar https://');
  if (env.NODE_ENV === 'production') {
    if (env.SWAGGER_ENABLED) problems.push('  - SWAGGER_ENABLED debe ser false en producción');
    if (env.MAIL_DRIVER !== 'resend')
      problems.push('  - MAIL_DRIVER debe ser resend en producción');
  }
  return problems;
}
