import { randomBytes } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { authorizeUrl, backToConnectors, googleOAuthClient, OAUTH_COOKIE, OAUTH_PATH, publicOrigin, redirectUri } from '../../../../../lib/google-calendar-oauth';
import { canWriteCredentials } from '../../../../../lib/permissions';
import { getSessionUser } from '../../../../../lib/session';

export const runtime = 'nodejs';

/**
 * Step 1 of "Conectar com Google": off to Google's consent screen, where the
 * person picks the account (marketing@, or their own). A connection is a
 * credential, so only admins start one — same rule as every other connector.
 */
export async function GET(request: NextRequest): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return NextResponse.redirect(new URL('/login', publicOrigin(request)));
  if (!canWriteCredentials(user)) return backToConnectors(request, 'Só um administrador pode conectar uma conta do Google.');

  const client = googleOAuthClient();
  if (!client) return backToConnectors(request, 'O login com Google não está configurado neste servidor (AUTH_GOOGLE_ID e AUTH_GOOGLE_SECRET).');

  // Ties Google's answer to this browser and this click (CSRF).
  const state = randomBytes(24).toString('base64url');
  const redirect = redirectUri(request);
  const response = NextResponse.redirect(authorizeUrl(client, redirect, state));
  response.cookies.set(OAUTH_COOKIE, state, { httpOnly: true, sameSite: 'lax', secure: redirect.startsWith('https://'), path: OAUTH_PATH, maxAge: 10 * 60 });
  return response;
}
