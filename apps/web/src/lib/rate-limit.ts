import { getRedis } from '@eve/core';

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
 * Fails open when Redis is unreachable: a login form that locks the whole team
 * out because a cache container restarted is a worse outcome than a brief
 * window without throttling. The failure is logged so it is not silent.
 */
export async function consumeLoginAttempt(identifier: string): Promise<RateLimitResult> {
  try {
    const redis = getRedis();
    const attempts = await redis.incr(key(identifier));
    if (attempts === 1) await redis.pexpire(key(identifier), WINDOW_MS);
    return { allowed: attempts <= MAX_ATTEMPTS, remaining: Math.max(0, MAX_ATTEMPTS - attempts) };
  } catch (error) {
    console.error('[rate-limit] Redis unavailable, allowing attempt:', error);
    return { allowed: true, remaining: MAX_ATTEMPTS };
  }
}

export async function clearLoginAttempts(identifier: string): Promise<void> {
  try {
    await getRedis().del(key(identifier));
  } catch {
    // Nothing to do: the key expires on its own.
  }
}
