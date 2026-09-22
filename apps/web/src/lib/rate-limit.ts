import { getRedis, withRedisTimeout } from '@eve/core';

const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
}

function key(identifier: string): string {
  return `eve:login-attempts:${identifier.toLowerCase()}`;
}

/**
 * Counts one login attempt against a 15-minute window.
 *
 * Fails open — and, critically, fails *fast*. A login form that hangs because
 * a cache container is down is worse than a brief window without throttling,
 * so every Redis call here is both timeout-bounded and wrapped. The failure is
 * logged rather than silent.
 */
export async function consumeLoginAttempt(identifier: string): Promise<RateLimitResult> {
  try {
    const redis = getRedis();
    const attempts = await withRedisTimeout(redis.incr(key(identifier)));
    if (attempts === 1) {
      await withRedisTimeout(redis.pexpire(key(identifier), WINDOW_MS));
    }
    return { allowed: attempts <= MAX_ATTEMPTS, remaining: Math.max(0, MAX_ATTEMPTS - attempts) };
  } catch (error) {
    console.error(
      '[rate-limit] Redis indisponivel, permitindo a tentativa:',
      error instanceof Error ? error.message : error,
    );
    return { allowed: true, remaining: MAX_ATTEMPTS };
  }
}

/**
 * Same fail-open, timeout-bounded counter as consumeLoginAttempt, for any
 * other public endpoint (today: "esqueci minha senha"). `bucket` keeps each
 * endpoint's counters apart from the login ones.
 */
export async function consumeRateLimit(
  bucket: string,
  identifier: string,
  max: number,
  windowMs: number,
): Promise<RateLimitResult> {
  const redisKey = `eve:rl:${bucket}:${identifier.toLowerCase()}`;
  try {
    const redis = getRedis();
    const attempts = await withRedisTimeout(redis.incr(redisKey));
    if (attempts === 1) {
      await withRedisTimeout(redis.pexpire(redisKey, windowMs));
    }
    return { allowed: attempts <= max, remaining: Math.max(0, max - attempts) };
  } catch (error) {
    console.error(`[rate-limit] Redis indisponivel (${bucket}), permitindo:`, error instanceof Error ? error.message : error);
    return { allowed: true, remaining: max };
  }
}

export async function clearLoginAttempts(identifier: string): Promise<void> {
  try {
    await withRedisTimeout(getRedis().del(key(identifier)));
  } catch {
    // Nothing to do: the key expires on its own.
  }
}
