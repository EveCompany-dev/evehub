import type { FieldSchema } from '@eve/connector-sdk';
import type { ViewConfig } from '@eve/core/dashboard';

/** How many columns/cards show when the user hasn't picked an explicit subset. */
export const DEFAULT_FIELD_CAP = 6;

/**
 * Applies the user's field subset/order from `viewConfig`, or falls back to
 * the connector's own field order (capped) — same default a hardcoded widget
 * used to bake in, now just the "nothing configured yet" case.
 */
export function resolveFields(allFields: FieldSchema[], viewConfig: ViewConfig | null, cap = DEFAULT_FIELD_CAP): FieldSchema[] {
  if (viewConfig?.fields) {
    const byKey = new Map(allFields.map((field) => [field.key, field]));
    return viewConfig.fields.map((key) => byKey.get(key)).filter((field): field is FieldSchema => Boolean(field));
  }
  return allFields.slice(0, cap);
}
