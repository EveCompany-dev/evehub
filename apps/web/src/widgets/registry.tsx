'use client';

import dynamic from 'next/dynamic';
import type { ComponentType, JSX } from 'react';
import type { WidgetProps } from './types';

/**
 * The visual half of the connector contract.
 *
 * Deliberately separate from the runtime registry in @eve/connector-sdk: the
 * worker loads connectors to run syncs and must never import React. Both
 * halves are keyed by the same connector id.
 *
 * Every widget is lazy — one slow or broken module never blocks the rest of
 * the grid from rendering.
 */
const widgets: Record<string, ComponentType<WidgetProps>> = {
  demo: dynamic(() => import('./DemoWidget').then((mod) => mod.DemoWidget), {
    ssr: false,
    loading: () => <div className="eve-widget-loading">carregando modulo...</div>,
  }),
};

export function getWidget(connectorId: string): ComponentType<WidgetProps> | null {
  return widgets[connectorId] ?? null;
}

export function UnknownWidget({ connectorId }: { connectorId: string }): JSX.Element {
  return (
    <div className="eve-widget">
      <div className="eve-widget__body">
        <p>
          Nenhuma interface registrada para o connector <strong>{connectorId}</strong>.
        </p>
        <p className="eve-dim">
          O dado continua sincronizando normalmente — falta apenas o widget. Ver apps/web/src/widgets/registry.tsx.
        </p>
      </div>
    </div>
  );
}
