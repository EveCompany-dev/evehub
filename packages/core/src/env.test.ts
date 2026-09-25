import { afterEach, describe, expect, it } from 'vitest';
import { getEnv, resetEnvCache } from './env';

const BASE = {
  DATABASE_URL: 'postgresql://app:secret@localhost:5432/evehub',
  CREDENTIALS_KEY: 'Y2ktb25seS1rZXktbm90LWEtcmVhbC1zZWNyZXQtMzI=',
};

const PRODUCTION = {
  ...BASE,
  NODE_ENV: 'production',
  PUBLIC_BASE_URL: 'https://hub.example.com',
  AUTH_URL: 'https://hub.example.com',
  ALLOWED_EMAIL_DOMAIN: 'example.com',
};

const saved = { ...process.env };

function withEnv(values: Record<string, string | undefined>) {
  for (const key of ['NODE_ENV', 'PUBLIC_BASE_URL', 'AUTH_URL', 'ALLOWED_EMAIL_DOMAIN', 'DATABASE_URL', 'CREDENTIALS_KEY', 'ANTHROPIC_API_KEY']) delete process.env[key];
  for (const [key, value] of Object.entries(values)) if (value !== undefined) process.env[key] = value;
  resetEnvCache();
  return getEnv;
}

afterEach(() => {
  process.env = { ...saved };
  resetEnvCache();
});

describe('getEnv in production', () => {
  it('starts with every production variable set', () => {
    expect(withEnv(PRODUCTION)().PUBLIC_BASE_URL).toBe('https://hub.example.com');
  });

  it.each(['PUBLIC_BASE_URL', 'AUTH_URL', 'ALLOWED_EMAIL_DOMAIN'])('refuses to start without %s, naming it', (key) => {
    expect(withEnv({ ...PRODUCTION, [key]: undefined })).toThrow(new RegExp(`${key}: required in production`));
  });

  it('treats a blank value as missing', () => {
    expect(withEnv({ ...PRODUCTION, ALLOWED_EMAIL_DOMAIN: '  ' })).toThrow(/ALLOWED_EMAIL_DOMAIN: required in production/);
    expect(withEnv({ ...PRODUCTION, PUBLIC_BASE_URL: '' })).toThrow(/PUBLIC_BASE_URL: required in production/);
  });

  it('refuses a plain-http public address', () => {
    expect(withEnv({ ...PRODUCTION, PUBLIC_BASE_URL: 'http://hub.example.com', AUTH_URL: 'http://hub.example.com' })).toThrow(/PUBLIC_BASE_URL: must be an https/);
  });

  it('refuses an AUTH_URL on another origin than PUBLIC_BASE_URL', () => {
    expect(withEnv({ ...PRODUCTION, AUTH_URL: 'https://other.example.com' })).toThrow(/AUTH_URL: must point at the same origin/);
  });

  it('accepts an AUTH_URL that carries the Auth.js base path', () => {
    expect(withEnv({ ...PRODUCTION, AUTH_URL: 'https://hub.example.com/api/auth' })().AUTH_URL).toBe('https://hub.example.com/api/auth');
  });
});

describe('getEnv with .env.example blanks', () => {
  it('treats the optional keys left blank in .env.example as unset', () => {
    const env = withEnv({ ...PRODUCTION, ANTHROPIC_API_KEY: '', SMTP_URL: '', MAIL_FROM: '', UPLOADS_DIR: '' })();
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
  });
});

describe('getEnv outside production', () => {
  it('needs none of the production-only variables', () => {
    expect(withEnv({ ...BASE, NODE_ENV: 'development' })().ALLOWED_EMAIL_DOMAIN).toBeUndefined();
  });
});
