import { randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CredentialCryptoError, decryptJson, decryptSecret, encryptJson, encryptSecret, safeCompare } from './crypto';
import { resetEnvCache } from './env';

const KEY_V1 = randomBytes(32).toString('base64');
const KEY_V2 = randomBytes(32).toString('base64');

function setEnv(version: number, currentKey: string) {
  process.env.DATABASE_URL = 'postgresql://test/test';
  process.env.CREDENTIALS_KEY = currentKey;
  process.env.CREDENTIALS_KEY_VERSION = String(version);
  resetEnvCache();
}

describe('credential encryption', () => {
  beforeEach(() => setEnv(1, KEY_V1));

  afterEach(() => {
    delete process.env.CREDENTIALS_KEY_V1;
    resetEnvCache();
  });

  it('round-trips a secret', () => {
    const { data, keyVersion } = encryptSecret('notion-token-abc');
    expect(keyVersion).toBe(1);
    expect(decryptSecret(data, keyVersion)).toBe('notion-token-abc');
  });

  it('round-trips structured credentials', () => {
    const creds = { accessToken: 'x', refreshToken: 'y', expiresAt: 123 };
    const { data, keyVersion } = encryptJson(creds);
    expect(decryptJson(data, keyVersion)).toEqual(creds);
  });

  it('never produces the same ciphertext twice', () => {
    const a = encryptSecret('same');
    const b = encryptSecret('same');
    expect(a.data.equals(b.data)).toBe(false);
  });

  it('rejects a tampered payload instead of returning garbage', () => {
    const { data, keyVersion } = encryptSecret('sensitive');
    const last = data.length - 1;
    data.writeUInt8(data.readUInt8(last) ^ 0xff, last);
    expect(() => decryptSecret(data, keyVersion)).toThrow(CredentialCryptoError);
  });

  it('still decrypts rows written under the previous key after rotation', () => {
    const old = encryptSecret('written-before-rotation');
    expect(old.keyVersion).toBe(1);

    // Rotate: v2 becomes current, v1 stays available for reads.
    setEnv(2, KEY_V2);
    process.env.CREDENTIALS_KEY_V1 = KEY_V1;

    expect(decryptSecret(old.data, old.keyVersion)).toBe('written-before-rotation');
    expect(encryptSecret('written-after').keyVersion).toBe(2);
  });

  it('fails loudly when the old key was not kept', () => {
    const old = encryptSecret('orphan');
    setEnv(2, KEY_V2);
    expect(() => decryptSecret(old.data, old.keyVersion)).toThrow(/CREDENTIALS_KEY_V1/);
  });

  it('rejects a key of the wrong length', () => {
    setEnv(1, Buffer.from('too-short').toString('base64'));
    expect(() => encryptSecret('x')).toThrow(/32 bytes/);
  });
});

describe('safeCompare', () => {
  it('matches equal strings and rejects others without leaking length behaviour', () => {
    expect(safeCompare('secret', 'secret')).toBe(true);
    expect(safeCompare('secret', 'secrer')).toBe(false);
    expect(safeCompare('secret', 'longer-secret')).toBe(false);
  });
});
