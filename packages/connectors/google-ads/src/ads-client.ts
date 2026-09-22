/**
 * Minimal Google Ads REST client.
 *
 * No google-ads-api SDK on purpose: it pulls in gRPC and protobuf bundles for
 * the two endpoints this connector uses (an OAuth refresh and a GAQL search),
 * and it pins its own API version, which is exactly the thing we want to keep
 * visible in shared.ts.
 */

import { GOOGLE_ADS_BASE_URL } from './shared';

const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const TIMEOUT_MS = 20_000;
/** Refresh a little early: a token that expires mid-request is a failed sync. */
const EXPIRY_MARGIN_MS = 60_000;

export class GoogleAdsError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'GoogleAdsError';
  }
}

export interface GoogleAdsAuth {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  developerToken: string;
}

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

interface GoogleAdsFailureDetail {
  errors?: { message?: string; errorCode?: Record<string, string> }[];
}

interface GoogleAdsErrorBody {
  error?: {
    code?: number;
    message?: string;
    status?: string;
    details?: GoogleAdsFailureDetail[];
  };
}

export interface AdsSearchResponse<T> {
  results?: T[];
  nextPageToken?: string;
}

/**
 * Access tokens last an hour and the worker syncs every few minutes, so one
 * OAuth round trip per sync would be pure waste. Keyed by refresh token: two
 * instances sharing credentials share the token, and re-connecting with a new
 * refresh token never reuses the old one.
 */
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

/** Tests own the cache's lifetime; nothing in the app should need this. */
export function resetTokenCacheForTests(): void {
  tokenCache.clear();
}

async function withTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function getAccessToken(auth: GoogleAdsAuth, now: number = Date.now()): Promise<string> {
  const cached = tokenCache.get(auth.refreshToken);
  if (cached && cached.expiresAt > now) return cached.token;

  const body = new URLSearchParams({
    client_id: auth.clientId,
    client_secret: auth.clientSecret,
    refresh_token: auth.refreshToken,
    grant_type: 'refresh_token',
  });

  let response: Response;
  try {
    response = await withTimeout(OAUTH_TOKEN_URL, {
      method: 'POST',
      body,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new GoogleAdsError('O Google não respondeu a tempo ao renovar o acesso.', 504);
    }
    throw new GoogleAdsError(error instanceof Error ? error.message : String(error), 0);
  }

  const raw = await response.text();
  const parsed = (raw ? JSON.parse(raw) : {}) as TokenResponse;

  if (!response.ok || !parsed.access_token) {
    // invalid_grant is the one everybody hits: the refresh token was revoked,
    // expired after six months unused, or belongs to another OAuth client.
    const message =
      parsed.error === 'invalid_grant'
        ? 'O refresh token do Google foi revogado ou expirou. Gere um novo no OAuth Playground e reconecte.'
        : (parsed.error_description ?? parsed.error ?? `O Google recusou a renovação do acesso (HTTP ${response.status}).`);
    throw new GoogleAdsError(message, response.status, parsed.error);
  }

  const lifetimeMs = (parsed.expires_in ?? 3600) * 1000;
  tokenCache.set(auth.refreshToken, { token: parsed.access_token, expiresAt: now + lifetimeMs - EXPIRY_MARGIN_MS });
  return parsed.access_token;
}

/** Turns the API's nested failure payload into one line somebody can act on. */
export function describeError(status: number, body: GoogleAdsErrorBody): string {
  const failure = body.error?.details?.find((detail) => Array.isArray(detail.errors) && detail.errors.length > 0);
  const first = failure?.errors?.[0];
  const detail = first?.message ?? body.error?.message;

  if (status === 401) return 'O Google recusou o acesso. Reconecte a conta para gerar um token novo.';
  if (status === 403) {
    return detail?.includes('developer token')
      ? 'O developer token ainda não foi aprovado para esta conta. Confira o nível de acesso no API Center do Google Ads.'
      : `Sem permissão para ler essa conta do Google Ads: ${detail ?? 'verifique o login-customer-id.'}`;
  }
  if (status === 404) {
    return 'O Google não reconheceu essa versão da API. Atualize GOOGLE_ADS_API_VERSION em packages/connectors/google-ads/src/shared.ts.';
  }
  if (status === 429) return 'O Google Ads limitou a taxa de requisições. A próxima sincronização tenta de novo.';

  return detail ?? `O Google Ads respondeu HTTP ${status}.`;
}

/**
 * Runs one GAQL query. Uses `:search` rather than `:searchStream` because the
 * paged response is a plain object — the stream returns a JSON array of
 * chunks that would have to be reassembled for no gain at this size.
 */
export async function adsSearch<T>(
  auth: GoogleAdsAuth,
  options: { customerId: string; loginCustomerId?: string; query: string; pageSize?: number; pageToken?: string },
): Promise<AdsSearchResponse<T>> {
  const accessToken = await getAccessToken(auth);

  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    'developer-token': auth.developerToken,
    'Content-Type': 'application/json',
  };
  // Required whenever the account is reached through a manager account.
  if (options.loginCustomerId) headers['login-customer-id'] = options.loginCustomerId;

  let response: Response;
  try {
    response = await withTimeout(`${GOOGLE_ADS_BASE_URL}/customers/${options.customerId}/googleAds:search`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        query: options.query,
        ...(options.pageSize ? { pageSize: options.pageSize } : {}),
        ...(options.pageToken ? { pageToken: options.pageToken } : {}),
      }),
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new GoogleAdsError('O Google Ads não respondeu a tempo.', 504);
    }
    throw new GoogleAdsError(error instanceof Error ? error.message : String(error), 0);
  }

  const raw = await response.text();
  const parsed = (raw ? JSON.parse(raw) : {}) as unknown;

  if (!response.ok) {
    const body = parsed as GoogleAdsErrorBody;
    throw new GoogleAdsError(describeError(response.status, body), response.status, body.error?.status);
  }

  return parsed as AdsSearchResponse<T>;
}
