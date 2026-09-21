'use client';

import dynamic from 'next/dynamic';
import type { ComponentType } from 'react';
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
  notion: dynamic(() => import('./NotionWidget').then((mod) => mod.NotionWidget), {
    ssr: false,
    loading: () => <div className="eve-widget-loading">carregando modulo...</div>,
  }),
  calculator: dynamic(() => import('./CalculatorWidget').then((mod) => mod.CalculatorWidget), {
    ssr: false,
    loading: () => <div className="eve-widget-loading">carregando modulo...</div>,
  }),
  notes: dynamic(() => import('./NotesWidget').then((mod) => mod.NotesWidget), {
    ssr: false,
    loading: () => <div className="eve-widget-loading">carregando modulo...</div>,
  }),
  chat: dynamic(() => import('./ChatWidget').then((mod) => mod.ChatWidget), {
    ssr: false,
    loading: () => <div className="eve-widget-loading">carregando modulo...</div>,
  }),
  calendar: dynamic(() => import('./CalendarWidget').then((mod) => mod.CalendarWidget), {
    ssr: false,
    loading: () => <div className="eve-widget-loading">carregando modulo...</div>,
  }),
  overview: dynamic(() => import('./TodayWidget').then((mod) => mod.TodayWidget), {
    ssr: false,
    loading: () => <div className="eve-widget-loading">carregando modulo...</div>,
  }),
  timer: dynamic(() => import('./TimerWidget').then((mod) => mod.TimerWidget), {
    ssr: false,
    loading: () => <div className="eve-widget-loading">carregando modulo...</div>,
  }),
};

const genericWidget: ComponentType<WidgetProps> = dynamic(
  () => import('./GenericConnectorWidget').then((mod) => mod.GenericConnectorWidget),
  {
    ssr: false,
    loading: () => <div className="eve-widget-loading">carregando modulo...</div>,
  },
);

/**
 * Any connector id without a bespoke entry above renders through the generic
 * config-driven engine instead of a dead-end "no widget registered" message —
 * this is what lets a future connector (Meta Ads, Google Ads) ship with just
 * `sync()`/`describeFields()` and no new widget file.
 */
export function getWidget(connectorId: string): ComponentType<WidgetProps> {
  return widgets[connectorId] ?? genericWidget;
}
