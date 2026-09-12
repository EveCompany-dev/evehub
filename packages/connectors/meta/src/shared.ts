/**
 * Client-safe half of the connector: no token, no network. The scheduling UI
 * imports from here; the actual Graph API calls live in graph-client.ts and
 * publish.ts (server-only).
 */
export const PLATFORMS = ['instagram', 'facebook'] as const;
export type Platform = (typeof PLATFORMS)[number];

/**
 * Pinned Graph API version. Meta retires versions on a roughly two-year
 * cadence — check developers.facebook.com/docs/graph-api/changelog before
 * this stops being current, this is a conscious upgrade, not a side effect.
 */
export const GRAPH_VERSION = 'v23.0';
