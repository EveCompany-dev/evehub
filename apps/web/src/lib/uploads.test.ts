import path from 'node:path';
import { resetEnvCache } from '@eve/core';
import { beforeAll, describe, expect, it } from 'vitest';
import { ATTACHMENT_EXTENSIONS, ATTACHMENT_TYPES, isAllowedType, resolveUploadPath, UPLOAD_URL_PATTERN } from './uploads';

const ROOT = path.join(path.sep, 'srv', 'eve-uploads');

beforeAll(() => {
  // getEnv() validates the whole schema, so the unrelated required keys need a
  // value; only UPLOADS_DIR matters here.
  process.env.DATABASE_URL ??= 'postgresql://user:pass@localhost:5432/db';
  process.env.CREDENTIALS_KEY ??= 'dGVzdC1vbmx5LWtlecKtbm90LWEtcmVhbC1zZWNyZXQ=';
  process.env.UPLOADS_DIR = ROOT;
  resetEnvCache();
});

describe('resolveUploadPath', () => {
  it('resolves both the app-relative and the absolute form to the same file', () => {
    const expected = path.join(ROOT, 'team-chat', 'a.png');
    expect(resolveUploadPath('/uploads/team-chat/a.png')).toBe(expected);
    expect(resolveUploadPath('https://hub.evecompany.com.br/uploads/team-chat/a.png')).toBe(expected);
  });

  it('refuses a relative url that climbs out of the upload root', () => {
    // The original bug: this passed a startsWith('/uploads/') check and then
    // escaped via path.join, so deleting your own chat message unlinked an
    // arbitrary file.
    expect(resolveUploadPath('/uploads/../../etc/passwd')).toBeNull();
    expect(resolveUploadPath('/uploads/../../../../../../etc/passwd')).toBeNull();
    expect(resolveUploadPath('/uploads/team-chat/../../../secrets.env')).toBeNull();
  });

  it('refuses an absolute url that climbs out of the upload root', () => {
    expect(resolveUploadPath('https://hub.example.com/uploads/../../etc/passwd')).toBeNull();
  });

  it('refuses urls that do not name an upload at all', () => {
    expect(resolveUploadPath('/etc/passwd')).toBeNull();
    expect(resolveUploadPath('/uploadsX/a.png')).toBeNull();
    expect(resolveUploadPath('file:///etc/passwd')).toBeNull();
    expect(resolveUploadPath('not a url')).toBeNull();
    expect(resolveUploadPath('')).toBeNull();
  });

  it('refuses a percent-encoded traversal', () => {
    // WHATWG URL counts %2e%2e as a double-dot segment and collapses it, so
    // these normalize out of /uploads/ entirely rather than reaching the disk.
    expect(resolveUploadPath('/uploads/%2e%2e/%2e%2e/etc/passwd')).toBeNull();
    expect(resolveUploadPath('/uploads/%2E%2E/%2E%2E/etc/passwd')).toBeNull();
    expect(resolveUploadPath('/uploads/.%2e/.%2e/etc/passwd')).toBeNull();
  });
});

describe('UPLOAD_URL_PATTERN', () => {
  it('accepts what saveUpload actually returns', () => {
    expect(UPLOAD_URL_PATTERN.test('/uploads/team-chat/0f1e2d3c-4b5a-6978-8765-4321fedcba98.png')).toBe(true);
    expect(UPLOAD_URL_PATTERN.test('/uploads/bug-reports/0f1e2d3c-4b5a-6978-8765-4321fedcba98.jpeg')).toBe(true);
    // No extension: safeExtension drops it for an executable type.
    expect(UPLOAD_URL_PATTERN.test('/uploads/direct-chat/0f1e2d3c-4b5a-6978-8765-4321fedcba98')).toBe(true);
  });

  it('rejects anything a client could point somewhere else', () => {
    expect(UPLOAD_URL_PATTERN.test('/uploads/../../etc/passwd')).toBe(false);
    expect(UPLOAD_URL_PATTERN.test('/uploads/team-chat/../../../x.png')).toBe(false);
    expect(UPLOAD_URL_PATTERN.test('https://attacker.example/uploads/team-chat/x.png')).toBe(false);
    expect(UPLOAD_URL_PATTERN.test('javascript:alert(1)')).toBe(false);
    expect(UPLOAD_URL_PATTERN.test('/uploads/team-chat/not-a-uuid.png')).toBe(false);
  });
});

describe('isAllowedType', () => {
  const allowed = (type: string, name: string) => isAllowedType({ type, name }, ATTACHMENT_TYPES, ATTACHMENT_EXTENSIONS);

  it('accepts a listed type', () => {
    expect(allowed('application/pdf', 'contrato.pdf')).toBe(true);
  });

  it('accepts a design file or archive the browser sent without a type', () => {
    expect(allowed('', 'arte.psd')).toBe(true);
    expect(allowed('application/octet-stream', 'pack.rar')).toBe(true);
  });

  it('refuses SVG and HTML however they are labelled', () => {
    expect(allowed('image/svg+xml', 'x.svg')).toBe(false);
    expect(allowed('', 'x.svg')).toBe(false);
    expect(allowed('text/html', 'x.html')).toBe(false);
    expect(allowed('application/octet-stream', 'x.html')).toBe(false);
  });

  it('does not let a known extension excuse an unlisted type', () => {
    expect(allowed('text/html', 'x.pdf')).toBe(false);
  });
});
