import type { ConnectorAuthKind } from '@eve/connector-sdk';
import { z } from 'zod';

export interface PermissionSubject {
  isOwner: boolean;
}

/**
 * Every nav section a Role can grant/withhold. 'chat' through 'automations'
 * are the DEFAULT_TABS every authenticated non-owner already gets — listing
 * them here too means a future role could theoretically be *more*
 * restrictive than default, even though nothing does that today.
 */
export const TAB_KEYS = ['chat', 'jobs', 'tables', 'connectors', 'automations', 'scheduling', 'financial', 'team'] as const;
export type TabKey = (typeof TAB_KEYS)[number];

const DEFAULT_TABS: readonly TabKey[] = ['chat', 'jobs', 'tables', 'connectors', 'automations'];

const roleTabsSchema = z.array(z.string()).catch([]);

/** Parses a Role.tabs JSON column into a clean string array — never throws on garbage data. */
export function parseRoleTabs(value: unknown): string[] {
  return roleTabsSchema.parse(value);
}

export interface TabSubject {
  isOwner: boolean;
  isSocialMedia: boolean;
  /** null = no Role assigned. Pass `parseRoleTabs(role.tabs)` for an assigned one. */
  roleTabs: string[] | null;
}

/**
 * The product's entire tab-visibility model, in one place.
 *
 * Owner bypasses this completely — always sees every tab, has since before
 * roles existed, and a Role can never take that away. Everyone else gets
 * DEFAULT_TABS, plus 'scheduling' if tagged isSocialMedia (a legacy shortcut
 * kept for backward compat), plus whatever their assigned Role's `tabs`
 * array adds — that's the only way a non-owner ever reaches 'financial' or
 * 'team'. A Role only ever *adds* visibility; it can't take away a default
 * tab or the isSocialMedia shortcut.
 */
export function getVisibleTabs(user: TabSubject): Set<TabKey> {
  if (user.isOwner) return new Set(TAB_KEYS);

  const tabs = new Set<TabKey>(DEFAULT_TABS);
  if (user.isSocialMedia) tabs.add('scheduling');
  for (const tab of user.roleTabs ?? []) {
    if ((TAB_KEYS as readonly string[]).includes(tab)) tabs.add(tab as TabKey);
  }
  return tabs;
}

export function canViewTab(user: TabSubject, tab: TabKey): boolean {
  return getVisibleTabs(user).has(tab);
}

/** Builds a TabSubject from the shape every call site fetches: `select: { isOwner, isSocialMedia, role: { select: { tabs: true } } }`. */
export function toTabSubject(row: { isOwner: boolean; isSocialMedia: boolean; role: { tabs: unknown } | null }): TabSubject {
  return { isOwner: row.isOwner, isSocialMedia: row.isSocialMedia, roleTabs: row.role ? parseRoleTabs(row.role.tabs) : null };
}

/**
 * The product's entire authorization model for actions (as opposed to tab
 * *visibility*, above), in one place. The single hard rule: connector
 * credentials are the clients' Meta and Google Ads tokens, so creating or
 * changing a connector that carries one is owner-only, full stop — no Role
 * can grant that. A connector that needs no secret (the demo) is open to
 * everyone.
 */
export function canCreateInstance(user: PermissionSubject, connectorAuth: ConnectorAuthKind): boolean {
  return connectorAuth === 'none' || user.isOwner;
}

/** Writing a secret is always owner-only, whatever the connector is. */
export function canWriteCredentials(user: PermissionSubject): boolean {
  return user.isOwner;
}

/**
 * Deleting an instance destroys its sync history and audit trail, so it is
 * owner-only even for a credential-free connector. Removing a widget from your
 * own dashboard is a different, unrestricted action.
 */
export function canDeleteInstance(user: PermissionSubject): boolean {
  return user.isOwner;
}

/**
 * Mutating the team — adding people, promoting/demoting, disabling, and
 * managing Roles themselves — stays owner-only no matter what, since a
 * misconfigured Role could otherwise let someone hand themselves admin
 * access. A Role granting the 'team' *tab* only ever gets a read-only
 * roster view — see canViewTab(user, 'team') for that.
 */
export function canManageTeam(user: PermissionSubject): boolean {
  return user.isOwner;
}

/** Financeiro is fully governed by the 'financial' tab — a Role that grants it can view and manage entries, not just look. */
export function canViewFinancial(user: TabSubject): boolean {
  return canViewTab(user, 'financial');
}

/** Agenda de posts: 'scheduling' tab — isOwner, isSocialMedia, or an assigned Role all fall out of getVisibleTabs(). */
export function canViewScheduling(user: TabSubject): boolean {
  return canViewTab(user, 'scheduling');
}

/** O token de automacoes e uma credencial (abre um endpoint de ingestao publico) — owner-only, mesma logica de canWriteCredentials. No Role can grant this. */
export function canManageAutomations(user: PermissionSubject): boolean {
  return user.isOwner;
}

/** Read-only roster access via the 'team' tab — see canManageTeam for the (always owner-only) mutation gate. */
export function canViewTeamTab(user: TabSubject): boolean {
  return user.isOwner || canViewTab(user, 'team');
}

export interface GuardResult {
  ok: boolean;
  reason?: string;
}

/**
 * Impede o workspace de ficar sem nenhum owner.
 *
 * Sem esta trava da para se trancar do lado de fora com dois cliques: o unico
 * owner remove o proprio acesso de admin e ninguem mais consegue promover
 * alguem — so mexendo direto no banco.
 */
export function validateOwnerChange(input: {
  targetIsOwner: boolean;
  nextIsOwner: boolean;
  ownerCount: number;
}): GuardResult {
  const removingOwner = input.targetIsOwner && !input.nextIsOwner;
  if (removingOwner && input.ownerCount <= 1) {
    return { ok: false, reason: 'Este é o único owner do workspace. Promova outra pessoa antes de remover o acesso de admin.' };
  }
  return { ok: true };
}

/**
 * Conceder admin so acontece na criacao da conta.
 *
 * O botao da lista virou um caminho unico — tirar admin de alguem, nunca dar.
 * Promover depois era o jeito facil de um owner distraido espalhar acesso a
 * credencial de cliente pela equipe inteira; nascer admin e uma decisao
 * consciente, tomada uma vez, com o nome e o e-mail da pessoa na frente.
 */
export function validateOwnerGrant(input: { targetIsOwner: boolean; nextIsOwner: boolean }): GuardResult {
  if (!input.targetIsOwner && input.nextIsOwner) {
    return {
      ok: false,
      reason: 'Acesso de admin só pode ser dado na criação da conta. Crie a conta já como admin, ou peça para a pessoa ser recriada.',
    };
  }
  return { ok: true };
}

/**
 * Apagar de vez, e nao so desativar.
 *
 * Tres travas, nesta ordem: a conta precisa ja estar desativada (desativar e o
 * passo reversivel; apagar nao e), ninguem apaga a si mesmo, e o ultimo owner
 * nunca sai. O conteudo de workspace e verificado separado, na rota — depende
 * de contagem no banco, nao de regra pura.
 */
export function validateDelete(input: {
  actorId: string;
  targetId: string;
  targetIsOwner: boolean;
  targetDisabled: boolean;
  ownerCount: number;
}): GuardResult {
  if (input.actorId === input.targetId) {
    return { ok: false, reason: 'Você não pode apagar a própria conta.' };
  }
  if (!input.targetDisabled) {
    return { ok: false, reason: 'Desative a conta antes de apagar. Assim ninguém apaga alguém por engano num clique só.' };
  }
  if (input.targetIsOwner && input.ownerCount <= 1) {
    return { ok: false, reason: 'Este é o único owner do workspace.' };
  }
  return { ok: true };
}

/** Mesma logica para desativar: desativar o ultimo owner tambem tranca todo mundo. */
export function validateDisable(input: {
  actorId: string;
  targetId: string;
  targetIsOwner: boolean;
  ownerCount: number;
  nextDisabled: boolean;
}): GuardResult {
  if (!input.nextDisabled) return { ok: true };

  if (input.actorId === input.targetId) {
    return { ok: false, reason: 'Você não pode desativar a própria conta.' };
  }
  if (input.targetIsOwner && input.ownerCount <= 1) {
    return { ok: false, reason: 'Este é o único owner do workspace.' };
  }
  return { ok: true };
}
