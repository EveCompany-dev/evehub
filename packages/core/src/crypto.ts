import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';
import { getEnv } from './env';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

export class CredentialCryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CredentialCryptoError';
  }
}

/**
 * Resolves the key for a given version.
 *
 * The current version lives in CREDENTIALS_KEY. Older versions stay readable
 * through CREDENTIALS_KEY_V<n> during a rotation, so rotating never requires
 * decrypting and rewriting every row in one shot.
 */
function keyForVersion(version: number): Buffer {
  const env = getEnv();
  const raw = version === env.CREDENTIALS_KEY_VERSION ? env.CREDENTIALS_KEY : process.env[`CREDENTIALS_KEY_V${version}`];

  if (!raw) {
    throw new CredentialCryptoError(
      `No key available for credentials key version ${version}. Set CREDENTIALS_KEY_V${version} to decrypt rows written before the last rotation.`,
    );
  }

  const key = Buffer.from(raw, 'base64');
  if (key.length !== KEY_BYTES) {
    throw new CredentialCryptoError(
      `Credentials key version ${version} must be ${KEY_BYTES} bytes (base64). Generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`,
    );
  }
  return key;
}

export interface EncryptedCredentials {
  data: Buffer;
  keyVersion: number;
}

/** Layout: [12-byte IV][16-byte auth tag][ciphertext]. */
export function encryptSecret(plaintext: string): EncryptedCredentials {
  const keyVersion = getEnv().CREDENTIALS_KEY_VERSION;
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, keyForVersion(keyVersion), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return { data: Buffer.concat([iv, cipher.getAuthTag(), ciphertext]), keyVersion };
}

export function decryptSecret(payload: Uint8Array, keyVersion: number): string {
  const buffer = Buffer.from(payload);
  if (buffer.length <= IV_BYTES + TAG_BYTES) {
    throw new CredentialCryptoError('Encrypted credential payload is truncated.');
  }

  const iv = buffer.subarray(0, IV_BYTES);
  const tag = buffer.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = buffer.subarray(IV_BYTES + TAG_BYTES);

  const decipher = createDecipheriv(ALGORITHM, keyForVersion(keyVersion), iv);
  decipher.setAuthTag(tag);

  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    // GCM auth failure: wrong key, or the ciphertext was tampered with.
    throw new CredentialCryptoError('Could not decrypt credentials: wrong key or corrupted payload.');
  }
}

export function encryptJson(value: unknown): EncryptedCredentials {
  return encryptSecret(JSON.stringify(value));
}

export function decryptJson<T = unknown>(payload: Uint8Array, keyVersion: number): T {
  return JSON.parse(decryptSecret(payload, keyVersion)) as T;
}

/** Constant-time compare, for webhook secrets and similar shared tokens. */
export function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
