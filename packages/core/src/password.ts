import { hash, verify } from '@node-rs/argon2';

/**
 * argon2id at the OWASP baseline (19 MiB, 2 iterations, 1 lane).
 * Kept in one place so the seed script and the auth provider can never drift
 * into hashing with different parameters.
 */
const ARGON2_OPTIONS = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export async function hashPassword(plaintext: string): Promise<string> {
  return hash(plaintext, ARGON2_OPTIONS);
}

export async function verifyPassword(storedHash: string, plaintext: string): Promise<boolean> {
  try {
    return await verify(storedHash, plaintext, ARGON2_OPTIONS);
  } catch {
    // A malformed hash in the database is a failed login, not a 500.
    return false;
  }
}

let dummyHash: Promise<string> | undefined;

/**
 * Burns the same time a real verification would.
 *
 * Without this, "unknown e-mail" returns noticeably faster than "wrong
 * password", which turns the login form into a user enumeration oracle.
 */
export async function equalizeVerifyTiming(plaintext: string): Promise<false> {
  dummyHash ??= hashPassword('eve-hub-timing-equalizer');
  await verifyPassword(await dummyHash, plaintext);
  return false;
}
