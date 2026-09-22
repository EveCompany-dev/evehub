import { PrismaAdapter } from '@auth/prisma-adapter';
import { equalizeVerifyTiming, isAdminEmail, prisma, verifyPassword } from '@eve/core';
import NextAuth, { CredentialsSignin, type NextAuthConfig } from 'next-auth';
import type { Adapter, AdapterUser } from 'next-auth/adapters';
import Credentials from 'next-auth/providers/credentials';
import Google from 'next-auth/providers/google';
import { z } from 'zod';
import { logActivity } from './lib/activity';
import { clearLoginAttempts, consumeLoginAttempt } from './lib/rate-limit';
import { parseRoleTabs } from './lib/permissions';

class RateLimitedSignin extends CredentialsSignin {
  override code = 'rate_limited';
}

/**
 * Raised when the lookup itself failed (database down), as opposed to the
 * credentials being wrong. Without this the user is told their password is
 * incorrect and goes hunting for a typo while Postgres is simply not running.
 */
class ServiceUnavailableSignin extends CredentialsSignin {
  override code = 'server_error';
}

const credentialsSchema = z.object({
  // .trim() nao e detalhe: teclado de celular e autocomplete acrescentam espaco
  // no fim do e-mail o tempo todo, e sem isso o login falha com a senha certa.
  // A senha NAO e trimada de proposito — espaco ali pode ser intencional.
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
});

async function defaultWorkspaceId(): Promise<string> {
  const existing = await prisma.workspace.findFirst({ orderBy: { createdAt: 'asc' } });
  if (existing) return existing.id;

  const created = await prisma.workspace.create({
    data: { name: process.env.SEED_WORKSPACE_NAME ?? 'EveCompany' },
  });
  return created.id;
}

/**
 * The stock Prisma adapter creates users without a workspace, which our schema
 * requires. Wrapping just `createUser` fills it in without forking the whole
 * adapter. Only the admins ever reach this: the signIn callback turns away a
 * Google login for an e-mail nobody registered (see there).
 */
function eveAdapter(): Adapter {
  const base = PrismaAdapter(prisma);

  return {
    ...base,
    async createUser(data) {
      const { id: _ignored, ...rest } = data as AdapterUser & { id?: string };
      const user = await prisma.user.create({
        data: { ...rest, workspaceId: await defaultWorkspaceId(), isOwner: isAdminEmail(rest.email) },
      });
      return user as AdapterUser;
    },
  };
}

export const authConfig: NextAuthConfig = {
  adapter: eveAdapter(),
  // Database sessions cannot be combined with the credentials provider in
  // Auth.js v5, and the team asked for both Google and e-mail/senha. The
  // Session table stays in the schema so switching later is a config change.
  session: { strategy: 'jwt', maxAge: 12 * 60 * 60 },
  trustHost: true,
  pages: { signIn: '/login' },

  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
      // The seeded owner already exists by e-mail. Without this, their first
      // Google login fails with OAuthAccountNotLinked. Safe here because
      // sign-in is restricted to one Google Workspace domain with verified
      // addresses; it would NOT be safe on a public sign-up.
      allowDangerousEmailAccountLinking: true,
    }),

    Credentials({
      name: 'E-mail e senha',
      credentials: {
        email: { label: 'E-mail', type: 'email' },
        password: { label: 'Senha', type: 'password' },
      },
      async authorize(raw) {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;

        const email = parsed.data.email;

        const limit = await consumeLoginAttempt(email);
        if (!limit.allowed) throw new RateLimitedSignin();

        let user;
        try {
          user = await prisma.user.findUnique({ where: { email } });
        } catch (error) {
          console.error('[auth] falha ao consultar o usuario:', error);
          throw new ServiceUnavailableSignin();
        }

        // Unknown user, disabled account and wrong password must all cost the
        // same time, or the form becomes a user-enumeration oracle.
        if (!user?.passwordHash || user.disabledAt) {
          await equalizeVerifyTiming(parsed.data.password);
          return null;
        }

        if (!(await verifyPassword(user.passwordHash, parsed.data.password))) return null;

        await clearLoginAttempts(email);
        return { id: user.id, email: user.email, name: user.name, image: user.image };
      },
    }),
  ],

  callbacks: {
    async signIn({ user, account, profile }) {
      // Vale para qualquer provider: acesso revogado e revogado.
      let existing: { disabledAt: Date | null } | null = null;
      if (user.email) {
        existing = await prisma.user.findUnique({
          where: { email: user.email.toLowerCase() },
          select: { disabledAt: true },
        });
        if (existing?.disabledAt) return '/login?error=AccessDenied';
      }

      if (account?.provider !== 'google') return true;

      if (profile && profile.email_verified === false) return false;

      const email = (user.email ?? profile?.email ?? '').toLowerCase();

      const domain = process.env.ALLOWED_EMAIL_DOMAIN?.trim().toLowerCase();
      if (domain && !email.endsWith(`@${domain}`)) return '/login?error=AccessDenied';

      // Quem entra e decisao dos admins: um Google do dominio sem conta
      // cadastrada nao cria conta sozinho. Sem isto, apagar alguem nao
      // adiantava nada — a pessoa voltava no clique seguinte com o Google da
      // empresa ainda ativo. As contas de admin sao a excecao, para que nenhum
      // banco novo ou restaurado tranque os dois do lado de fora.
      if (!existing && !isAdminEmail(email)) return '/login?error=NotRegistered';

      return true;
    },

    async jwt({ token, user }) {
      if (user?.id) token.sub = user.id;
      return token;
    },

    /**
     * Reads the user fresh on every `auth()` call. That is one query per
     * request, which is nothing at 20 users, and it means revoking `isOwner`
     * takes effect immediately instead of whenever the JWT happens to expire.
     */
    async session({ session, token }) {
      if (!token.sub) return session;

      const user = await prisma.user.findUnique({
        where: { id: token.sub },
        select: {
          id: true,
          email: true,
          name: true,
          image: true,
          isOwner: true,
          isSocialMedia: true,
          workspaceId: true,
          disabledAt: true,
          role: { select: { tabs: true } },
        },
      });

      // Conta desativada perde a sessao ja aberta na proxima requisicao, sem
      // precisar esperar o JWT expirar. getSessionUser trata isto como deslogado.
      if (!user || user.disabledAt) return session;

      // Admin vem da lista fixa, nunca da coluna. Se a coluna divergir (banco
      // restaurado, edicao manual), a sessao ja usa o valor certo e corrige o
      // espelho, que o worker e algumas paginas leem.
      const isAdmin = isAdminEmail(user.email);
      if (user.isOwner !== isAdmin) {
        await prisma.user.update({ where: { id: user.id }, data: { isOwner: isAdmin } }).catch(() => undefined);
      }

      session.user = {
        ...session.user,
        id: user.id,
        email: user.email,
        name: user.name,
        image: user.image,
        isOwner: isAdmin,
        isSocialMedia: user.isSocialMedia,
        roleTabs: user.role ? parseRoleTabs(user.role.tabs) : null,
        workspaceId: user.workspaceId,
      };

      return session;
    },
  },

  events: {
    async signIn({ user, account }) {
      if (!user.id) return;
      // Feeds the "delta desde a ultima visita" of the daily AI feed (v0.0.6).
      const row = await prisma.user
        .update({
          where: { id: user.id },
          data: { lastSeenAt: new Date() },
          select: { id: true, name: true, email: true, workspaceId: true },
        })
        .catch(() => null);
      if (!row) return;

      await logActivity(row, {
        action: 'auth.signIn',
        summary: account?.provider === 'google' ? 'entrou no Eve Hub (Google)' : 'entrou no Eve Hub (e-mail e senha)',
        entityType: 'user',
        entityId: row.id,
      });
    },
  },
};

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);
