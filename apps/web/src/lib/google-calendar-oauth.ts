import { GOOGLE_CALENDAR_SCOPES } from '@eve/connector-google-calendar/shared';
import { encryptJson, getEnv, prisma, runSync } from '@eve/core';
import { NextResponse } from 'next/server';

/**
 * "Conectar com Google" for the Google Agenda connector: Google's own consent
 * screen instead of pasting tokens. It reuses the OAuth client the login
 * already has (AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET); that client needs the
 * Google Calendar API enabled and `<site>/api/connectors/google-calendar/callback`
 * among its redirect URIs.
 */

export const OAUTH_PATH = '/api/connectors/google-calendar';
export const OAUTH_COOKIE = 'eve_gcal_oauth';
const AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';

export interface OAuthClient {
  clientId: string;
  clientSecret: string;
}

export function googleOAuthClient(): OAuthClient | null {
  const clientId = process.env.AUTH_GOOGLE_ID?.trim();
  const clientSecret = process.env.AUTH_GOOGLE_SECRET?.trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

/**
 * The address the browser actually used. In production that is always
 * PUBLIC_BASE_URL (getEnv() refuses to start without it): request headers are
 * whatever the client sent, and the OAuth redirect must not follow them. Only
 * in dev, with it unset, does this fall back to what the proxy says, then the
 * request's own origin. Google compares the redirect URI character by
 * character, so web:3000 behind Caddy won't do.
 */
export function publicOrigin(request: Request): string {
  const env = getEnv();
  if (env.PUBLIC_BASE_URL) return new URL(env.PUBLIC_BASE_URL).origin;
  if (env.NODE_ENV === 'production') throw new Error('PUBLIC_BASE_URL is required in production.');
  const own = new URL(request.url);
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  const proto = request.headers.get('x-forwarded-proto') ?? own.protocol.replace(':', '');
  return host ? `${proto}://${host}` : own.origin;
}

export function redirectUri(request: Request): string {
  return `${publicOrigin(request)}${OAUTH_PATH}/callback`;
}

/** Back to Equipe > Conectores with the reason it didn't work, which the page shows (?googleAgenda=...). */
export function backToConnectors(request: Request, reason: string): NextResponse {
  const url = new URL('/team', publicOrigin(request));
  url.searchParams.set('googleAgenda', reason);
  return NextResponse.redirect(url);
}

export function authorizeUrl(client: OAuthClient, redirect: string, state: string): string {
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set('client_id', client.clientId);
  url.searchParams.set('redirect_uri', redirect);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', GOOGLE_CALENDAR_SCOPES.join(' '));
  // offline + consent: the only way Google hands out a refresh token every time.
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent select_account');
  url.searchParams.set('include_granted_scopes', 'true');
  url.searchParams.set('state', state);
  return url.toString();
}

/** Trades the one-time code for tokens and reads which account granted them. */
export async function exchangeCode(client: OAuthClient, code: string, redirect: string): Promise<{ refreshToken: string; email: string }> {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: client.clientId, client_secret: client.clientSecret, redirect_uri: redirect, grant_type: 'authorization_code' }),
  });
  const tokens = (await response.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; error_description?: string; error?: string };
  if (!response.ok || !tokens.access_token) throw new Error(tokens.error_description ?? tokens.error ?? `O Google recusou a conexão (HTTP ${response.status}).`);
  if (!tokens.refresh_token) {
    throw new Error('O Google não liberou acesso contínuo. Remova o Eve Hub em myaccount.google.com/permissions e conecte de novo.');
  }

  const info = (await (await fetch(USERINFO_URL, { headers: { Authorization: `Bearer ${tokens.access_token}` } })).json().catch(() => ({}))) as { email?: string };
  if (!info.email) throw new Error('O Google não informou o e-mail da conta.');
  return { refreshToken: tokens.refresh_token, email: info.email.toLowerCase() };
}

/**
 * Saves the connection — reconnecting an account already connected refreshes
 * its access instead of adding a second copy — and runs its first sync.
 */
export async function saveGoogleCalendarConnection(input: {
  workspaceId: string;
  client: OAuthClient;
  refreshToken: string;
  email: string;
}): Promise<{ instanceId: string; created: boolean; syncError: string | null }> {
  const encrypted = encryptJson({ clientId: input.client.clientId, clientSecret: input.client.clientSecret, refreshToken: input.refreshToken });
  const existing = (await prisma.connectorInstance.findMany({ where: { workspaceId: input.workspaceId, connectorId: 'google-calendar' }, select: { id: true, config: true } })).find(
    (instance) => (instance.config as { accountEmail?: string } | null)?.accountEmail === input.email,
  );

  const instance = existing
    ? await prisma.connectorInstance.update({
        where: { id: existing.id },
        data: { credentialsEnc: new Uint8Array(encrypted.data), credentialsKeyVersion: encrypted.keyVersion, status: 'ok', statusMessage: null },
        select: { id: true },
      })
    : await prisma.connectorInstance.create({
        data: {
          workspaceId: input.workspaceId,
          connectorId: 'google-calendar',
          label: `Google Agenda · ${input.email}`,
          config: { accountEmail: input.email, calendarIds: ['*'] },
          credentialsEnc: new Uint8Array(encrypted.data),
          credentialsKeyVersion: encrypted.keyVersion,
        },
        select: { id: true },
      });

  const first = await runSync(instance.id);
  return { instanceId: instance.id, created: !existing, syncError: first.ok ? null : (first.error ?? 'A primeira sincronização falhou.') };
}
