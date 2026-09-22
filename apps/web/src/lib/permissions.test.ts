import { ADMIN_EMAILS, isAdminEmail } from '@eve/core/admins';
import { describe, expect, it } from 'vitest';
import {
  canCreateInstance,
  canDeleteInstance,
  canManageTeam,
  canViewActivityLog,
  canViewFinancial,
  canViewScheduling,
  canViewTeamTab,
  canWriteCredentials,
  getVisibleTabs,
  parseRoleTabs,
  ROLE_GRANTABLE_TABS,
  validateDelete,
  validateDisable,
  validateEmailChange,
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

  it('keeps the activity log admin-only', () => {
    expect(canViewActivityLog(owner)).toBe(true);
    expect(canViewActivityLog(member)).toBe(false);
  });
});

describe('admin list', () => {
  it('is exactly the two EveCompany admin accounts', () => {
    expect([...ADMIN_EMAILS].sort()).toEqual(['financeiro@evecompany.com.br', 'jose@evecompany.com.br']);
  });

  it('matches regardless of case and stray whitespace', () => {
    expect(isAdminEmail('Jose@EveCompany.com.br')).toBe(true);
    expect(isAdminEmail(' financeiro@evecompany.com.br ')).toBe(true);
  });

  it('rejects everyone else, including lookalikes', () => {
    expect(isAdminEmail('marketing@evecompany.com.br')).toBe(false);
    expect(isAdminEmail('jose@evecompany.com.br.evil.com')).toBe(false);
    expect(isAdminEmail('xjose@evecompany.com.br')).toBe(false);
    expect(isAdminEmail('')).toBe(false);
    expect(isAdminEmail(null)).toBe(false);
  });
});

describe('team guards', () => {
  it('scopes team management to admins', () => {
    expect(canManageTeam(owner)).toBe(true);
    expect(canManageTeam(member)).toBe(false);
  });

  it('never lets you disable your own account', () => {
    const result = validateDisable({ actorId: 'u1', targetId: 'u1', targetIsAdmin: false, nextDisabled: true });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/própria conta/);
  });

  it('refuses to disable an admin account', () => {
    const result = validateDisable({ actorId: 'u1', targetId: 'u2', targetIsAdmin: true, nextDisabled: true });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/administrador/);
  });

  it('disables a member', () => {
    expect(validateDisable({ actorId: 'u1', targetId: 'u2', targetIsAdmin: false, nextDisabled: true }).ok).toBe(true);
  });

  it('re-enabling is never blocked', () => {
    expect(validateDisable({ actorId: 'u1', targetId: 'u1', targetIsAdmin: true, nextDisabled: false }).ok).toBe(true);
  });

  it('validateDelete requires the account to be deactivated first', () => {
    const guard = validateDelete({ actorId: 'a', targetId: 'b', targetIsAdmin: false, targetDisabled: false });
    expect(guard.ok).toBe(false);
    expect(guard.reason).toMatch(/Desative a conta antes/);
  });

  it('validateDelete refuses self-deletion even when disabled', () => {
    expect(validateDelete({ actorId: 'a', targetId: 'a', targetIsAdmin: false, targetDisabled: true }).ok).toBe(false);
  });

  it('validateDelete refuses an admin account, and allows a disabled member', () => {
    expect(validateDelete({ actorId: 'a', targetId: 'b', targetIsAdmin: true, targetDisabled: true }).ok).toBe(false);
    expect(validateDelete({ actorId: 'a', targetId: 'b', targetIsAdmin: false, targetDisabled: true }).ok).toBe(true);
  });

  it('only an admin changes an e-mail', () => {
    const guard = validateEmailChange({ actorIsAdmin: false, currentIsAdminEmail: false, nextIsAdminEmail: false });
    expect(guard.ok).toBe(false);
    expect(validateEmailChange({ actorIsAdmin: true, currentIsAdminEmail: false, nextIsAdminEmail: false }).ok).toBe(true);
  });

  it('never renames an account to, or away from, an admin e-mail', () => {
    // The escalation this blocks: rename yourself to an admin address nobody has claimed yet.
    expect(validateEmailChange({ actorIsAdmin: true, currentIsAdminEmail: false, nextIsAdminEmail: true }).ok).toBe(false);
    expect(validateEmailChange({ actorIsAdmin: true, currentIsAdminEmail: true, nextIsAdminEmail: false }).ok).toBe(false);
    expect(validateEmailChange({ actorIsAdmin: false, currentIsAdminEmail: false, nextIsAdminEmail: true }).ok).toBe(false);
  });
});

describe('tab visibility (roles)', () => {
  it('gives an admin every tab, role or not, including the activity log', () => {
    const tabs = getVisibleTabs({ isOwner: true, isSocialMedia: false, roleTabs: null });
    expect(tabs.has('financial')).toBe(true);
    expect(tabs.has('team')).toBe(true);
    expect(tabs.has('scheduling')).toBe(true);
    expect(tabs.has('activity')).toBe(true);
  });

  it('gives a plain member the default tabs, which now include the read-only team roster', () => {
    const tabs = getVisibleTabs(noRole);
    expect([...tabs].sort()).toEqual(['automations', 'chat', 'connectors', 'jobs', 'tables', 'team']);
    expect(canViewTeamTab(noRole)).toBe(true);
    expect(canManageTeam(noRole)).toBe(false);
  });

  it('isSocialMedia adds scheduling on top of the default tabs, nothing else', () => {
    const tabs = getVisibleTabs({ isOwner: false, isSocialMedia: true, roleTabs: null });
    expect(tabs.has('scheduling')).toBe(true);
    expect(tabs.has('financial')).toBe(false);
  });

  it('a Role is the only way a member reaches financial', () => {
    const withRole = { isOwner: false, isSocialMedia: false, roleTabs: ['financial'] };
    expect(canViewFinancial(withRole)).toBe(true);
    expect(canViewFinancial(noRole)).toBe(false);
  });

  it('a Role can never reach the activity log, even if its JSON says so', () => {
    const tabs = getVisibleTabs({ isOwner: false, isSocialMedia: false, roleTabs: ['activity', 'financial'] });
    expect(tabs.has('activity')).toBe(false);
    expect(tabs.has('financial')).toBe(true);
    expect(ROLE_GRANTABLE_TABS).not.toContain('activity');
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
