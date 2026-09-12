import type { ViewConfig } from '@eve/core/dashboard';

export interface WidgetProps {
  instanceId: string;
  /** The user's label for this widget, already resolved from dashboardConfig. */
  title: string;
  onRemove: () => void;
  /** null = the widget's own default view. */
  viewConfig: ViewConfig | null;
  onViewConfigChange: (next: ViewConfig) => void;
}
