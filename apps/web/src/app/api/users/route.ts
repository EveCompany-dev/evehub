import { hashPassword, prisma } from '@eve/core';
import { strings } from '@eve/ui';
import { z } from 'zod';
import { fail, handle, ok } from '../../../lib/api';
import { canManageTeam } from '../../../lib/permissions';
import { HttpError, requireUser } from '../../../lib/session';

export const runtime = 'nodejs';

const createSchema = z.object({
  name: z.string().trim().min(1).max(80),
  email: z.string().trim().email().max(200),
  /** Opcional: sem senha a pessoa entra so pelo Google. */
  password: z.string().min(8, 'A senha precisa de pelo menos 8 caracteres.').max(200).optional().or(z.literal('')),
  isOwner: z.boolean().default(false),
});

/** Todo mundo do workspace, para a tela de equipe. Somente owner. */
export async function GET(): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();
    if (!canManageTeam(user)) throw new HttpError(403, strings.errors.notOwnerTeam);

    const users = await prisma.user.findMany({
      where: { workspaceId: user.workspaceId },
      orderBy: [{ isOwner: 'desc' }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        email: true,
        image: true,
        isOwner: true,
        lastSeenAt: true,
        disabledAt: true,
        createdAt: true,
        // O hash nunca sai daqui; so o fato de existir.
        passwordHash: true,
      },
    });

    return ok({
      users: users.map((row) => ({
        id: row.id,
        name: row.name,
        email: row.email,
        image: row.image,
        isOwner: row.isOwner,
        disabled: row.disabledAt !== null,
        hasPassword: Boolean(row.passwordHash),
        lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
      })),
    });
  });
}

/**
 * Cria uma conta no workspace.
 *
 * Quem tem e-mail do dominio autorizado ja entraria sozinho pelo Google — isto
 * serve para quem nao tem conta Google da empresa, para ja definir uma senha,
 * ou para deixar a pessoa cadastrada (e admin) antes do primeiro acesso.
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

    const created = await prisma.user.create({
      data: {
        workspaceId: actor.workspaceId,
        name: body.data.name,
        email,
        isOwner: body.data.isOwner,
        ...(body.data.password ? { passwordHash: await hashPassword(body.data.password) } : {}),
      },
      select: { id: true, name: true, email: true, image: true, isOwner: true, createdAt: true },
    });

    return ok(
      {
        user: {
          ...created,
          disabled: false,
          hasPassword: Boolean(body.data.password),
          lastSeenAt: null,
          createdAt: created.createdAt.toISOString(),
        },
      },
      201,
    );
  });
}
