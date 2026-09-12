/**
 * Client-safe half of the connector: the widget imports only this, never
 * `./store` (Redis) or the Anthropic call (server-only, lives in the Next.js
 * route, not this package — see apps/web/src/app/api/instances/[id]/chat).
 */
export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}

/** Keeps a conversation from growing the persisted store (and the Claude request) forever. */
export const MAX_MESSAGES = 100;
