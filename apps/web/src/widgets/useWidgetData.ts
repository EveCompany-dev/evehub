'use client';

import type { ConnectorStatusValue } from '@eve/ui';
import { useCallback, useEffect, useState } from 'react';
import { useConnectorEvents } from '../components/EventStreamProvider';

export interface WidgetRecord {
  remoteId: string;
  remoteVersion: string;
  data: Record<string, unknown>;
}

export interface WidgetUndoableEdit {
  id: string;
  remoteId: string;
  field: string;
  oldValue: unknown;
  newValue: unknown;
  createdAt: string;
  expiresAt: string;
  userName: string | null;
}

export interface WidgetData {
  instance: {
    id: string;
    connectorId: string;
    label: string;
    status: ConnectorStatusValue;
    statusMessage: string | null;
    lastSyncedAt: string | null;
    capabilities: { read: boolean; write: boolean; webhook: boolean };
  };
  snapshot: { data: unknown; syncedAt: string } | null;
  records: WidgetRecord[];
  undoableEdits: WidgetUndoableEdit[];
}

export interface UseWidgetData {
  data: WidgetData | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  syncNow: () => Promise<void>;
}

/**
 * Data plumbing shared by every connector widget: initial fetch, live refresh
 * driven by SSE, and manual sync. A connector's widget implements presentation
 * and editing only.
 */
export function useWidgetData(instanceId: string): UseWidgetData {
  const [data, setData] = useState<WidgetData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(`/api/instances/${instanceId}/data`, { cache: 'no-store' });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${response.status}`);
      }
      setData((await response.json()) as WidgetData);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [instanceId]);

  const syncNow = useCallback(async () => {
    try {
      const response = await fetch(`/api/instances/${instanceId}/sync`, { method: 'POST' });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? `HTTP ${response.status}`);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      // Refresh either way: a failed sync still updated status and statusMessage.
      await refresh();
    }
  }, [instanceId, refresh]);

  useEffect(() => {
    // Mount-time fetch. The rule flags this because it cannot see that every
    // setState inside refresh() happens after an await, never synchronously
    // during the effect — which is exactly the "subscribe to an external
    // system" case the rule documents as legitimate.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  useConnectorEvents(instanceId, () => {
    void refresh();
  });

  return { data, loading, error, refresh, syncNow };
}
