import { describe, expect, it } from 'vitest';
import {
  canCreateInstance,
  canDeleteInstance,
  canManageTeam,
  canWriteCredentials,
  validateDisable,
  validateOwnerChange,
} from './permissions';

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

describe('team guards', () => {
  it('scopes team management to owners', () => {
    expect(canManageTeam(owner)).toBe(true);
    expect(canManageTeam(member)).toBe(false);
  });

  it('refuses to remove the last owner, which would lock everyone out', () => {
    const result = validateOwnerChange({ targetIsOwner: true, nextIsOwner: false, ownerCount: 1 });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/unico owner/);
  });

  it('allows demoting an owner while another one remains', () => {
    expect(validateOwnerChange({ targetIsOwner: true, nextIsOwner: false, ownerCount: 2 }).ok).toBe(true);
  });

  it('always allows promoting someone', () => {
    expect(validateOwnerChange({ targetIsOwner: false, nextIsOwner: true, ownerCount: 1 }).ok).toBe(true);
  });

  it('never lets you disable your own account', () => {
    const result = validateDisable({
      actorId: 'u1',
      targetId: 'u1',
      targetIsOwner: true,
      ownerCount: 2,
      nextDisabled: true,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/propria conta/);
  });

  it('refuses to disable the last owner', () => {
    expect(
      validateDisable({ actorId: 'u1', targetId: 'u2', targetIsOwner: true, ownerCount: 1, nextDisabled: true }).ok,
    ).toBe(false);
  });

  it('re-enabling is never blocked', () => {
    expect(
      validateDisable({ actorId: 'u1', targetId: 'u1', targetIsOwner: true, ownerCount: 1, nextDisabled: false }).ok,
    ).toBe(true);
  });
});
