import { safeCompare } from '@eve/core';
import { NextResponse, type NextRequest } from 'next/server';
import { logActivity, quoted } from '../../../../../lib/activity';
import {
  backToConnectors,
  exchangeCode,
  googleOAuthClient,
  OAUTH_COOKIE,
  OAUTH_PATH,
  publicOrigin,
  redirectUri,
  saveGoogleCalendarConnection,
} from '../../../../../lib/google-calendar-oauth';
import { canWriteCredentials } from '../../../../../lib/permissions';
import { getSessionUser } from '../../../../../lib/session';

export const runtime = 'nodejs';

function withCookieCleared(response: NextResponse): NextResponse {
  response.cookies.set(OAUTH_COOKIE, '', { path: OAUTH_PATH, maxAge: 0 });
  return response;
}

/**
 * Step 2 of "Conectar com Google": Google sends the person back here with a
 * one-time code. Success lands on the Agenda do Time, which now has
 * something to show; anything else goes back to Conectores with the reason.
 */
export async function GET(request: NextRequest): Promise<Response> {
  const state = request.cookies.get(OAUTH_COOKIE)?.value ?? '';
  const user = await getSessionUser();
  if (!user) return NextResponse.redirect(new URL('/login', publicOrigin(request)));
  if (!canWriteCredentials(user)) return withCookieCleared(backToConnectors(request, 'Só um administrador pode conectar uma conta do Google.'));

  const params = request.nextUrl.searchParams;
  const denied = params.get('error');
  if (denied) return withCookieCleared(backToConnectors(request, denied === 'access_denied' ? 'A conexão foi cancelada no Google.' : `O Google recusou: ${denied}`));

  const code = params.get('code');
  if (!code || !state || !safeCompare(params.get('state') ?? '', state)) {
    return withCookieCleared(backToConnectors(request, 'O link de conexão expirou. Tente conectar de novo.'));
  }

  const client = googleOAuthClient();
  if (!client) return withCookieCleared(backToConnectors(request, 'O login com Google não está configurado neste servidor.'));

  try {
    const { refreshToken, email } = await exchangeCode(client, code, redirectUri(request));
    const saved = await saveGoogleCalendarConnection({ workspaceId: user.workspaceId, client, refreshToken, email });
    await logActivity(user, {
      action: saved.created ? 'connector.create' : 'connector.update',
      summary: `${saved.created ? 'conectou' : 'reconectou'} o Google Agenda de ${quoted(email)}${saved.syncError ? ' — a primeira sincronização falhou' : ''}`,
      entityType: 'connectorInstance',
      entityId: saved.instanceId,
    });
    if (saved.syncError) return withCookieCleared(backToConnectors(request, saved.syncError));
    return withCookieCleared(NextResponse.redirect(new URL('/agenda', publicOrigin(request))));
  } catch (error) {
    return withCookieCleared(backToConnectors(request, error instanceof Error ? error.message : String(error)));
  }
}
