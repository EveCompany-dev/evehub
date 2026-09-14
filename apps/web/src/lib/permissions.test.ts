import { describe, expect, it } from 'vitest';
import {
  canCreateInstance,
  canDeleteInstance,
  canManageTeam,
  canViewFinancial,
  canViewScheduling,
  canViewTeamTab,
  canWriteCredentials,
  getVisibleTabs,
  parseRoleTabs,
  validateDisable,
  validateOwnerChange,
} from './permissions';

const owner = { isOwner: true };
const member = { isOwner: false };
const noRole = { isOwner: false, isSocialMedia: false, roleTabs: null };

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
    expect(result.reason).toMatch(/único owner/);
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
    expect(result.reason).toMatch(/própria conta/);
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

describe('tab visibility (roles)', () => {
  it('gives an owner every tab, role or not', () => {
    const tabs = getVisibleTabs({ isOwner: true, isSocialMedia: false, roleTabs: null });
    expect(tabs.has('financial')).toBe(true);
    expect(tabs.has('team')).toBe(true);
    expect(tabs.has('scheduling')).toBe(true);
  });

  it('gives a plain non-owner only the default tabs', () => {
    const tabs = getVisibleTabs(noRole);
    expect([...tabs].sort()).toEqual(['automations', 'chat', 'connectors', 'jobs', 'tables']);
  });

  it('isSocialMedia adds scheduling on top of the default tabs, nothing else', () => {
    const tabs = getVisibleTabs({ isOwner: false, isSocialMedia: true, roleTabs: null });
    expect(tabs.has('scheduling')).toBe(true);
    expect(tabs.has('financial')).toBe(false);
  });

  it('a Role is the only way a non-owner reaches financial or team', () => {
    const withRole = { isOwner: false, isSocialMedia: false, roleTabs: ['financial', 'team'] };
    expect(canViewFinancial(withRole)).toBe(true);
    expect(canViewTeamTab(withRole)).toBe(true);
    expect(canViewFinancial(noRole)).toBe(false);
    expect(canViewTeamTab(noRole)).toBe(false);
  });

  it('a Role cannot take away the default tabs or the isSocialMedia shortcut', () => {
    const tabs = getVisibleTabs({ isOwner: false, isSocialMedia: true, roleTabs: ['financial'] });
    expect(tabs.has('jobs')).toBe(true);
    expect(tabs.has('scheduling')).toBe(true);
    expect(tabs.has('financial')).toBe(true);
  });

  it('canViewScheduling still respects the legacy isSocialMedia shortcut', () => {
    expect(canViewScheduling({ isOwner: false, isSocialMedia: true, roleTabs: null })).toBe(true);
    expect(canViewScheduling(noRole)).toBe(false);
  });

  it('ignores unknown/garbage tab strings from a corrupted Role.tabs value', () => {
    const tabs = getVisibleTabs({ isOwner: false, isSocialMedia: false, roleTabs: ['financial', 'not-a-real-tab'] });
    expect(tabs.has('financial')).toBe(true);
    expect([...tabs]).not.toContain('not-a-real-tab');
  });

  it('parseRoleTabs falls back to an empty array for non-array JSON', () => {
    expect(parseRoleTabs(null)).toEqual([]);
    expect(parseRoleTabs('garbage')).toEqual([]);
    expect(parseRoleTabs(['financial', 42])).toEqual([]);
    expect(parseRoleTabs(['financial', 'team'])).toEqual(['financial', 'team']);
  });
});
