'use client';

import { strings } from '@eve/ui';
import { Component, type ErrorInfo, type JSX, type ReactNode } from 'react';

export interface WidgetErrorBoundaryProps {
  title: string;
  onRemove: () => void;
  children: ReactNode;
}

interface WidgetErrorBoundaryState {
  error: Error | null;
}

/**
 * One bad widget must never take the whole dashboard down with it. React
 * error boundaries are the only mechanism that actually stops a render
 * exception from unmounting everything above it — a try/catch in a widget's
 * own code can't catch errors thrown during React's render phase.
 *
 * Deliberately a class component: error boundaries have no hook equivalent
 * (no `useErrorBoundary` in React yet) — `getDerivedStateFromError`/
 * `componentDidCatch` are still the only lifecycle that catches render errors.
 */
export class WidgetErrorBoundary extends Component<WidgetErrorBoundaryProps, WidgetErrorBoundaryState> {
  override state: WidgetErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): WidgetErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[widget] "${this.props.title}" crashed:`, error, info.componentStack);
  }

  private reset = (): void => this.setState({ error: null });

  override render(): ReactNode | JSX.Element {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <section className="eve-widget eve-widget--crashed">
        <header className="eve-widget__header">
          <h3 className="eve-widget__title">{this.props.title}</h3>
        </header>
        <div className="eve-widget__body">
          <p className="eve-alert eve-alert--error">{strings.widget.crashed}</p>
          <p className="eve-dim">{error.message}</p>
          <div className="eve-profile__actions">
            <button type="button" className="eve-btn eve-no-drag" onClick={this.reset}>
              {strings.widget.retry}
            </button>
            <button type="button" className="eve-btn eve-btn--danger eve-no-drag" onClick={this.props.onRemove}>
              {strings.dashboard.removeWidget}
            </button>
          </div>
        </div>
      </section>
    );
  }
}
