/**
 * Client-safe half of the connector.
 *
 * A connector's widget runs in the browser and must never reach the runtime
 * module, which imports Redis/HTTP clients and secrets handling. Anything the
 * widget needs — option lists, field names, display types — lives here.
 *
 * Every connector package should follow this split: `.` is server-only,
 * `./shared` is importable from a widget.
 */
export const DEMO_STATUSES = ['Ativo', 'Pausado', 'Em analise', 'Encerrado'] as const;
export type DemoStatus = (typeof DEMO_STATUSES)[number];

/** Fields the connector accepts writes for. Enforced again server-side. */
export const EDITABLE_FIELDS = ['status', 'owner', 'notes'] as const;
export type EditableField = (typeof EDITABLE_FIELDS)[number];
