import type { ConnectorAuthKind } from '@eve/connector-sdk';
import { z } from 'zod';

export interface PermissionSubject {
  isOwner: boolean;
}

/**
 * Every nav section. 'activity' (the registro de atividades) is admin-only
 * and outside what a Role can allow — see ROLE_GRANTABLE_TABS.
 */
export const TAB_KEYS = ['chat', 'jobs', 'tables', 'connectors', 'automations', 'scheduling', 'financial', 'team', 'activity'] as const;
export type TabKey = (typeof TAB_KEYS)[number];

/**
 * Every tab a non-admin can have — all of them on by default — and what the
 * Role editor offers. A Role never reaches the activity log, whatever its JSON says.
 */
export const ROLE_GRANTABLE_TABS: readonly TabKey[] = TAB_KEYS.filter((tab) => tab !== 'activity');

export const TAB_LABELS: Record<TabKey, string> = {
  chat: 'Chat',
  jobs: 'Jobs',
  tables: 'Tabelas',
  connectors: 'Conectores',
  automations: 'Automações',
  scheduling: 'Agenda',
  financial: 'Financeiro',
  team: 'Equipe',
  activity: 'Registro de atividades',
};

/** What a cargo lets its members open, in words: "todas as abas", "todas menos Financeiro", "só Chat, Jobs". */
export function describeRoleTabs(tabs: unknown): string {
  const allowed = ROLE_GRANTABLE_TABS.filter((tab) => Array.isArray(tabs) && tabs.includes(tab));
  const hidden = ROLE_GRANTABLE_TABS.filter((tab) => !allowed.includes(tab));
  const names = (list: readonly TabKey[]) => list.map((tab) => TAB_LABELS[tab]).join(', ');
  if (hidden.length === 0) return 'todas as abas';
  if (allowed.length === 0) return 'nenhuma aba';
  return hidden.length <= allowed.length ? `todas menos ${names(hidden)}` : `só ${names(allowed)}`;
}

const roleTabsSchema = z.array(z.string()).catch([]);

/** Parses a Role.tabs JSON column into a clean string array — never throws on garbage data. */
export function parseRoleTabs(value: unknown): string[] {
  return roleTabsSchema.parse(value);
}

export interface TabSubject {
  isOwner: boolean;
  /** null = no Role assigned. Pass `parseRoleTabs(role.tabs)` for an assigned one. */
  roleTabs: string[] | null;
}

/**
 * The product's entire tab-visibility model, in one place.
 *
 * Owner bypasses this completely — always sees every tab, activity log
 * included, and a Role can never take that away. Everyone else starts with
 * every ROLE_GRANTABLE_TABS entry; an assigned Role is an allow-list, so the
 * only thing that ever hides a tab from a member is a cargo that leaves it
 * out. A Role can never add 'activity'. (Until 2026-09-22 a Role *added* tabs
 * to a fixed default set — the role_tabs_allow_list migration rewrote every
 * existing Role so nobody's view changed.)
 */
export function getVisibleTabs(user: TabSubject): Set<TabKey> {
  if (user.isOwner) return new Set(TAB_KEYS);
  if (user.roleTabs === null) return new Set(ROLE_GRANTABLE_TABS);
  return new Set(ROLE_GRANTABLE_TABS.filter((tab) => user.roleTabs!.includes(tab)));
}

export function canViewTab(user: TabSubject, tab: TabKey): boolean {
  return getVisibleTabs(user).has(tab);
}

/** Builds a TabSubject from the shape every call site fetches: `select: { isOwner, role: { select: { tabs: true } } }`. */
export function toTabSubject(row: { isOwner: boolean; role: { tabs: unknown } | null }): TabSubject {
  return { isOwner: row.isOwner, roleTabs: row.role ? parseRoleTabs(row.role.tabs) : null };
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
 * Mutating the team — adding people, disabling, deleting, resetting a
 * password, and managing Roles themselves — is admin-only no matter what.
 * Everyone else gets the read-only roster (unless a cargo hides 'team'):
 * they see each other, they cannot act on each other.
 */
export function canManageTeam(user: PermissionSubject): boolean {
  return user.isOwner;
}

/** O registro de atividades mostra o que cada pessoa fez — so os admins leem. */
export function canViewActivityLog(user: PermissionSubject): boolean {
  return user.isOwner;
}

/** Financeiro is fully governed by the 'financial' tab — a Role that grants it can view and manage entries, not just look. */
export function canViewFinancial(user: TabSubject): boolean {
  return canViewTab(user, 'financial');
}

/** Agenda, Calendário de Conteúdo e Agendar Post: the 'scheduling' tab. */
export function canViewScheduling(user: TabSubject): boolean {
  return canViewTab(user, 'scheduling');
}

/** O token de automacoes e uma credencial (abre um endpoint de ingestao publico) — owner-only, mesma logica de canWriteCredentials. No Role can grant this. */
export function canManageAutomations(user: PermissionSubject): boolean {
  return user.isOwner;
}

/** A cor do status vale para o workspace inteiro, entao so o owner define — o resto so enxerga o resultado. */
export function canManageJobColumnColors(user: PermissionSubject): boolean {
  return user.isOwner;
}

/** Read-only roster: true for every signed-in account a cargo doesn't hide it from. See canManageTeam for the (admin-only) mutation gate. */
export function canViewTeamTab(user: TabSubject): boolean {
  return user.isOwner || canViewTab(user, 'team');
}

export interface GuardResult {
  ok: boolean;
  reason?: string;
}

const ADMIN_LOCKED = 'Contas de administrador são definidas no código do Eve Hub e não podem ser desativadas nem apagadas por aqui.';

/**
 * Apagar de vez, e nao so desativar.
 *
 * Tres travas, nesta ordem: ninguem apaga a si mesmo, conta de admin nunca
 * sai por aqui (a lista e fixa no codigo — ver @eve/core/admins), e a conta
 * precisa ja estar desativada (desativar e o passo reversivel; apagar nao e).
 * Conteudo no workspace (jobs, chat) NAO trava mais: a rota tira os dados da
 * pessoa e deixa o trabalho dela, assinado so com o nome.
 */
export function validateDelete(input: {
  actorId: string;
  targetId: string;
  targetIsAdmin: boolean;
  targetDisabled: boolean;
}): GuardResult {
  if (input.actorId === input.targetId) {
    return { ok: false, reason: 'Você não pode apagar a própria conta.' };
  }
  if (input.targetIsAdmin) return { ok: false, reason: ADMIN_LOCKED };
  if (!input.targetDisabled) {
    return { ok: false, reason: 'Desative a conta antes de apagar. Assim ninguém apaga alguém por engano num clique só.' };
  }
  return { ok: true };
}

/** Mesma logica para desativar: ninguem se tranca do lado de fora, e admin nao sai por um clique. */
export function validateDisable(input: {
  actorId: string;
  targetId: string;
  targetIsAdmin: boolean;
  nextDisabled: boolean;
}): GuardResult {
  if (!input.nextDisabled) return { ok: true };

  if (input.actorId === input.targetId) {
    return { ok: false, reason: 'Você não pode desativar a própria conta.' };
  }
  if (input.targetIsAdmin) return { ok: false, reason: ADMIN_LOCKED };
  return { ok: true };
}

/**
 * Trocar o e-mail de alguem (e o login da pessoa).
 *
 * So admin troca, e nunca para ou a partir de um e-mail de admin: se desse,
 * bastava renomear a propria conta para "financeiro@..." antes da conta real
 * existir para virar admin. Pelo mesmo motivo ninguem troca o proprio e-mail
 * no perfil — ver /api/profile.
 */
export function validateEmailChange(input: {
  actorIsAdmin: boolean;
  currentIsAdminEmail: boolean;
  nextIsAdminEmail: boolean;
}): GuardResult {
  if (!input.actorIsAdmin) {
    return { ok: false, reason: 'Só um administrador pode trocar o e-mail de uma conta.' };
  }
  if (input.currentIsAdminEmail || input.nextIsAdminEmail) {
    return { ok: false, reason: 'E-mails de administrador são fixos e não podem ser atribuídos nem trocados.' };
  }
  return { ok: true };
}
