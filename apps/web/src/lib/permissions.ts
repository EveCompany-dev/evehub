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
