import type { ConnectorAuthKind } from '@eve/connector-sdk';

export interface PermissionSubject {
  isOwner: boolean;
}

/**
 * The product's entire authorization model, in one place.
 *
 * There are no roles by design: any authenticated user builds their dashboard
 * however they like. The single exception is connector credentials — those are
 * the clients' Meta and Google Ads tokens, so creating or changing a connector
 * that carries one is owner-only. A connector that needs no secret (the demo)
 * is open to everyone.
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

/** Quem pode ver e mexer na equipe. Mesma regra do resto: so owner. */
export function canManageTeam(user: PermissionSubject): boolean {
  return user.isOwner;
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
    return { ok: false, reason: 'Este e o unico owner do workspace. Promova outra pessoa antes de remover o acesso de admin.' };
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
    return { ok: false, reason: 'Voce nao pode desativar a propria conta.' };
  }
  if (input.targetIsOwner && input.ownerCount <= 1) {
    return { ok: false, reason: 'Este e o unico owner do workspace.' };
  }
  return { ok: true };
}
