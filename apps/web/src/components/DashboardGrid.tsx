'use client';

import type { DashboardConfig, ViewConfig, WidgetLayout } from '@eve/core/dashboard';
import { strings } from '@eve/ui';
import type { JSX } from 'react';
import GridLayout, { useContainerWidth, type Layout } from 'react-grid-layout';
import { getWidget } from '../widgets/registry';
import { WidgetErrorBoundary } from '../widgets/WidgetErrorBoundary';

/** Below this width a 12-column grid stops being usable, so widgets stack. */
const NARROW_BREAKPOINT = 720;

const GRID_SPACING: Record<DashboardConfig['density'], { rowHeight: number; margin: [number, number] }> = {
  comfortable: { rowHeight: 40, margin: [16, 16] },
  compact: { rowHeight: 28, margin: [8, 8] },
};

export interface InstanceSummary {
  id: string;
  connectorId: string;
  label: string;
}

export interface DashboardGridProps {
  config: DashboardConfig;
  instances: InstanceSummary[];
  onLayoutChange: (layout: WidgetLayout[]) => void;
  onRemove: (instanceId: string) => void;
  onViewConfigChange: (instanceId: string, next: ViewConfig) => void;
}

/** Quando travado, o grid vira layout fixo: nem arrastar, nem redimensionar. */

export function DashboardGrid({
  config,
  instances,
  onLayoutChange,
  onRemove,
  onViewConfigChange,
}: DashboardGridProps): JSX.Element {
  const { width, containerRef, mounted } = useContainerWidth();

  const byId = new Map(instances.map((instance) => [instance.id, instance]));

  // Only render tiles whose instance still exists; a deleted instance leaves a
  // stale layout entry behind and must not blank out the grid.
  const visible = config.layout.filter((item) => byId.has(item.i));

  const renderWidget = (item: WidgetLayout) => {
    const instance = byId.get(item.i);
    if (!instance) return null;

    const settings = config.widgets[item.i];
    const title = settings?.title ?? instance.label;
    const Widget = getWidget(instance.connectorId);

    return (
      <WidgetErrorBoundary title={title} onRemove={() => onRemove(instance.id)}>
        <Widget
          instanceId={instance.id}
          title={title}
          onRemove={() => onRemove(instance.id)}
          viewConfig={settings?.viewConfig ?? null}
          onViewConfigChange={(next) => onViewConfigChange(instance.id, next)}
        />
      </WidgetErrorBoundary>
    );
  };

  if (visible.length === 0) {
    return (
      <div className="eve-empty">
        <p className="eve-empty__title">{strings.dashboard.empty}</p>
        <p className="eve-dim">{strings.dashboard.emptyHint}</p>
      </div>
    );
  }

  const spacing = GRID_SPACING[config.density];
  const containerClassName = [
    'eve-grid-container',
    config.locked ? 'is-locked' : null,
    config.density === 'compact' ? 'is-compact' : null,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div ref={containerRef} className={containerClassName}>
      {!mounted ? (
        <div className="eve-dim">carregando layout...</div>
      ) : width < NARROW_BREAKPOINT ? (
        // Stacked, non-draggable column on phones. Dragging a 12-column grid
        // on a 400px screen is worse than not having it.
        <div className="eve-stack">
          {visible.map((item) => (
            <div key={item.i} className="eve-stack__item">
              {renderWidget(item)}
            </div>
          ))}
        </div>
      ) : (
        <GridLayout
          width={width}
          layout={visible}
          gridConfig={{ cols: 12, rowHeight: spacing.rowHeight, margin: spacing.margin, containerPadding: [0, 0] }}
          // The widget header is the drag handle; buttons inside it opt out
          // through .eve-no-drag so a menu click is never read as a drag.
          dragConfig={{ enabled: !config.locked, handle: '.eve-widget__header', cancel: '.eve-no-drag' }}
          resizeConfig={{ enabled: !config.locked, handles: ['se'] }}
          onLayoutChange={(layout: Layout) => {
            onLayoutChange(layout.map(({ i, x, y, w, h }) => ({ i, x, y, w, h })));
          }}
        >
          {visible.map((item) => (
            <div key={item.i}>{renderWidget(item)}</div>
          ))}
        </GridLayout>
      )}
    </div>
  );
}
