import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),

  /** Base64-encoded 32-byte key for connector credential encryption. */
  CREDENTIALS_KEY: z.string().min(1, 'CREDENTIALS_KEY is required'),
  CREDENTIALS_KEY_VERSION: z.coerce.number().int().positive().default(1),

  SYNC_INTERVAL_MS: z.coerce.number().int().min(30_000).default(300_000),
  SNAPSHOT_RETENTION_DAYS: z.coerce.number().int().positive().default(30),

  /** Optional: the chat widget reports itself as unconfigured without this, same spirit as Google OAuth. */
  ANTHROPIC_API_KEY: z.string().min(1).optional(),

  /**
   * Public origin of this app, e.g. https://hub.evecompany.com.br. Only the
   * post-media upload endpoint needs it, and only because Meta's servers
   * download scheduled post images from the URL we hand them: deriving that
   * URL from the incoming request gives `http://localhost:3000` in dev and
   * whatever internal address a reverse proxy forwards in production, and
   * neither is fetchable from the public internet. Optional — unset falls
   * back to the request origin, which is correct whenever the app is already
   * reached at its public address.
   *
   * Preprocessed because dotenv turns a present-but-blank
   * `PUBLIC_BASE_URL=""` into an empty string rather than leaving it unset,
   * and an empty string is not a valid URL — it has to mean "not configured"
   * or copying .env.example verbatim would refuse to boot.
   */
  PUBLIC_BASE_URL: z.preprocess((value) => (value === '' ? undefined : value), z.string().url().optional()),
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
