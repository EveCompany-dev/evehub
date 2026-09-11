import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),

  /** Base64-encoded 32-byte key for connector credential encryption. */
  CREDENTIALS_KEY: z.string().min(1, 'CREDENTIALS_KEY is required'),
  CREDENTIALS_KEY_VERSION: z.coerce.number().int().positive().default(1),

  SYNC_INTERVAL_MS: z.coerce.number().int().min(30_000).default(300_000),
  SNAPSHOT_RETENTION_DAYS: z.coerce.number().int().positive().default(30),
});

export type EveEnv = z.infer<typeof envSchema>;

let cached: EveEnv | undefined;

/**
 * Parsed once, lazily. Lazy matters: importing anything from `@eve/core` in a
 * context that does not need the database (a unit test, a build step) should
 * not blow up on a missing DATABASE_URL.
 */
export function getEnv(): EveEnv {
  if (!cached) {
    const parsed = envSchema.safeParse(process.env);
    if (!parsed.success) {
      const details = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
      throw new Error(`Invalid environment configuration:\n${details}\n\nCopy .env.example to .env and fill it in.`);
    }
    cached = parsed.data;
  }
  return cached;
}

/** Test helper: forces the next getEnv() to re-read process.env. */
export function resetEnvCache(): void {
  cached = undefined;
}
