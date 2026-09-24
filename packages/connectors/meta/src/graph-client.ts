import { GRAPH_VERSION } from './shared';

const BASE_URL = `https://graph.facebook.com/${GRAPH_VERSION}`;
const TIMEOUT_MS = 20_000;

export class MetaGraphError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: number,
  ) {
    super(message);
    this.name = 'MetaGraphError';
  }
}

interface GraphErrorBody {
  error?: { message?: string; code?: number; error_subcode?: number };
}

/**
 * Minimal Graph API client: no SDK, just `fetch` plus the one header/param
 * shape every endpoint shares. `GET` params go on the query string; `POST`
 * params go as a form body.
 *
 * The token goes in an `Authorization: Bearer` header, never in the query
 * string. A URL is recorded by reverse proxies, TLS-terminating corporate
 * proxies and APM tools in a way a header is not, and this token is a client's
 * long-lived Page token — it can publish to and delete from their Facebook
 * Page and linked Instagram account. Graph accepts the header form, and the
 * Notion client in this repo already does it this way.
 */
export async function graphRequest<T>(
  token: string,
  path: string,
  init: { method?: 'GET' | 'POST' | 'DELETE'; params?: Record<string, string | number | boolean> } = {},
): Promise<T> {
  const method = init.method ?? 'GET';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(init.params ?? {})) {
    params.set(key, String(value));
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const query = params.toString();
    const url = method === 'GET' && query ? `${BASE_URL}${path}?${query}` : `${BASE_URL}${path}`;
    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(method !== 'GET' ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
      },
      ...(method !== 'GET' ? { body: params } : {}),
      signal: controller.signal,
    });

    const raw = await response.text();
    const parsed = raw ? (JSON.parse(raw) as unknown) : {};

    if (!response.ok) {
      const body = parsed as GraphErrorBody;
      throw new MetaGraphError(
        body.error?.message ?? `Meta respondeu HTTP ${response.status}.`,
        response.status,
        body.error?.code,
      );
    }

    return parsed as T;
  } catch (error) {
    if (error instanceof MetaGraphError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      throw new MetaGraphError('A Graph API não respondeu a tempo.', 504);
    }
    throw new MetaGraphError(error instanceof Error ? error.message : String(error), 0);
  } finally {
    clearTimeout(timer);
  }
}
