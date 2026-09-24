import type { JSX } from 'react';
import { strings } from './strings';

export type ConnectorStatusValue = 'ok' | 'syncing' | 'error' | 'disabled';

export interface StatusPillProps {
  status: ConnectorStatusValue;
  /** Shown on hover. For `error` this is the upstream failure message. */
  message?: string | null;
}

/**
 * Connector health, visible in every widget header.
 *
 * "Falha isolada" is the product's core claim; an isolated failure nobody can
 * see is indistinguishable from stale data, so this ships with every widget rather
 * than waiting for a monitoring screen later.
 */
export function StatusPill({ status, message }: StatusPillProps): JSX.Element {
  return (
    <span
      className={`eve-status eve-status--${status}`}
      title={message ?? undefined}
      aria-label={`status: ${strings.status[status]}`}
    >
      <span className="eve-status__dot" aria-hidden="true" />
      {strings.status[status]}
    </span>
  );
}
