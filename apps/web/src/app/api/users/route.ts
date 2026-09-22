import { hashPassword, isAdminEmail, prisma } from '@eve/core';
import { strings } from '@eve/ui';
import { z } from 'zod';
import { logActivity, personLabel } from '../../../lib/activity';
import { fail, handle, ok } from '../../../lib/api';
import { canManageTeam, canViewTeamTab } from '../../../lib/permissions';
import { HttpError, requireUser } from '../../../lib/session';

export const runtime = 'nodejs';

const createSchema = z.object({
  name: z.string().trim().min(1).max(80),
  email: z.string().trim().email().max(200),
  /** Opcional: sem senha a pessoa entra so pelo Google. */
  password: z.string().min(8, 'A senha precisa de pelo menos 8 caracteres.').max(200).optional().or(z.literal('')),
  isSocialMedia: z.boolean().default(false),
});

/**
 * A equipe.
 *
 * Admin recebe tudo o que precisa para administrar (conta desativada, se tem
 * senha, ultimo acesso). Todo o resto do time recebe so quem esta ativo, com
 * nome, e-mail, foto e cargo — ve os colegas, nao os detalhes da conta deles.
 * Conta apagada (lapide) nao aparece para ninguem.
 */
export async function GET(): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();
    if (!canViewTeamTab(user)) throw new HttpError(403, strings.errors.notOwnerTeam);
    const isAdmin = canManageTeam(user);

    const users = await prisma.user.findMany({
      where: { workspaceId: user.workspaceId, deletedAt: null, ...(isAdmin ? {} : { disabledAt: null }) },
      orderBy: [{ isOwner: 'desc' }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        email: true,
        image: true,
        isOwner: true,
        isSocialMedia: true,
        lastSeenAt: true,
        disabledAt: true,
        createdAt: true,
        // O hash nunca sai daqui; so o fato de existir.
        passwordHash: true,
        role: { select: { id: true, name: true } },
      },
    });

    return ok({
      canManage: isAdmin,
      users: users.map((row) => {
        const base = {
          id: row.id,
          name: row.name,
          email: row.email,
          image: row.image,
          isOwner: isAdminEmail(row.email),
          isSocialMedia: row.isSocialMedia,
          roleId: row.role?.id ?? null,
          roleName: row.role?.name ?? null,
        };
        if (!isAdmin) return { ...base, disabled: false, hasPassword: null, lastSeenAt: null };
        return {
          ...base,
          disabled: row.disabledAt !== null,
          hasPassword: Boolean(row.passwordHash),
          lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
          createdAt: row.createdAt.toISOString(),
        };
      }),
    });
  });
}

/**
 * Cria uma conta no workspace. Somente admin.
 *
 * Desde que o Google parou de criar conta sozinho (ver auth.ts), este e o
 * unico jeito de alguem novo entrar: sem senha, a pessoa entra pelo Google do
 * dominio; com senha, pelo formulario. Admin nao e escolha aqui — sai do
 * e-mail (ver @eve/core/admins).
 */
export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    const actor = await requireUser();
    if (!canManageTeam(actor)) throw new HttpError(403, strings.errors.notOwnerTeam);

    const body = createSchema.safeParse(await request.json());
    if (!body.success) {
      return fail(400, body.error.issues.map((issue) => issue.message).join('; '));
    }

    const email = body.data.email.toLowerCase();

    const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (existing) return fail(409, 'Ja existe uma conta com esse e-mail.');

    const isOwner = isAdminEmail(email);
    const created = await prisma.user.create({
      data: {
        workspaceId: actor.workspaceId,
        name: body.data.name,
        email,
        isOwner,
        isSocialMedia: body.data.isSocialMedia,
        ...(body.data.password ? { passwordHash: await hashPassword(body.data.password) } : {}),
      },
      select: { id: true, name: true, email: true, image: true, isOwner: true, isSocialMedia: true, createdAt: true },
    });

    await logActivity(actor, {
      action: 'user.create',
      summary: `criou a conta de ${personLabel(created)} (${created.email})${isOwner ? ' como admin' : ''}`,
      entityType: 'user',
      entityId: created.id,
      details: { withPassword: Boolean(body.data.password) },
    });

    return ok(
      {
        user: {
          ...created,
          disabled: false,
          hasPassword: Boolean(body.data.password),
          lastSeenAt: null,
          roleId: null,
          roleName: null,
          createdAt: created.createdAt.toISOString(),
        },
      },
      201,
    );
  });
}
