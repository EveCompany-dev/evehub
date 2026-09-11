export interface WidgetProps {
  instanceId: string;
  /** The user's label for this widget, already resolved from dashboardConfig. */
  title: string;
  onRemove: () => void;
}
