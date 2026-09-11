import { describe, expect, it } from 'vitest';
import { canCreateInstance, canDeleteInstance, canWriteCredentials } from './permissions';

const owner = { isOwner: true };
const member = { isOwner: false };

describe('permissions', () => {
  it('lets anyone add a connector that carries no secret', () => {
    expect(canCreateInstance(member, 'none')).toBe(true);
    expect(canCreateInstance(owner, 'none')).toBe(true);
  });

  it('restricts connectors that carry a client credential to owners', () => {
    for (const auth of ['oauth2', 'api_key', 'token', 'webhook'] as const) {
      expect(canCreateInstance(member, auth)).toBe(false);
      expect(canCreateInstance(owner, auth)).toBe(true);
    }
  });

  it('never lets a non-owner write a credential', () => {
    expect(canWriteCredentials(member)).toBe(false);
    expect(canWriteCredentials(owner)).toBe(true);
  });

  it('keeps instance deletion (and its audit trail) owner-only', () => {
    expect(canDeleteInstance(member)).toBe(false);
    expect(canDeleteInstance(owner)).toBe(true);
  });
});
