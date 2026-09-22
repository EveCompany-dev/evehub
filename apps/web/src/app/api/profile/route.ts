import { isAdminEmail, prisma } from '@eve/core';
import { strings } from '@eve/ui';
import { z } from 'zod';
import { logActivity, quoted } from '../../../lib/activity';
import { fail, handle, ok } from '../../../lib/api';
import { validateEmailChange } from '../../../lib/permissions';
import { requireUser } from '../../../lib/session';

export const runtime = 'nodejs';

const profileSchema = z.object({
  name: z.string().trim().min(1).max(80),
  email: z.string().trim().email().max(200),
  // Aceita tanto uma URL absoluta (colada a mao) quanto o path relativo que o
  // upload local devolve (/uploads/avatars/...).
  image: z
    .string()
    .trim()
    .max(500)
    .refine((value) => value === '' || value.startsWith('/uploads/') || /^https?:\/\//.test(value), {
      message: 'Imagem inválida.',
    })
    .or(z.literal(''))
    .nullable()
    .optional(),
});

export async function GET(): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();

    const row = await prisma.user.findUnique({
      where: { id: user.id },
      select: { id: true, name: true, email: true, image: true, isOwner: true, passwordHash: true, createdAt: true },
    });

    if (!row) return fail(404, strings.errors.notFound);

    return ok({
      profile: {
        id: row.id,
        name: row.name,
        email: row.email,
        image: row.image,
        isOwner: row.isOwner,
        // Never the hash itself — only whether one exists.
        hasPassword: Boolean(row.passwordHash),
        createdAt: row.createdAt.toISOString(),
      },
    });
  });
}

/** Updates name, e-mail and picture in one go. */
export async function PATCH(request: Request): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();

    const body = profileSchema.safeParse(await request.json());
    if (!body.success) {
      return fail(400, body.error.issues.map((issue) => issue.message).join('; '));
    }

    const email = body.data.email.toLowerCase();

    // E-mail is the login identity — and, with admin tied to a fixed list of
    // e-mails, changing your own used to be a way to *become* admin (rename
    // yourself to an admin address nobody had claimed yet). Nobody changes
    // their own any more; an admin changes other people's from the team page.
    if (email !== user.email.toLowerCase()) {
      const guard = validateEmailChange({
        actorIsAdmin: user.isOwner,
        currentIsAdminEmail: isAdminEmail(user.email),
        nextIsAdminEmail: isAdminEmail(email),
      });
      return fail(403, guard.ok ? 'Troque o e-mail pela tela de Equipe.' : (guard.reason ?? 'Mudança não permitida.'));
    }

    const before = await prisma.user.findUnique({ where: { id: user.id }, select: { name: true, image: true } });
    const nextImage = body.data.image ? body.data.image : null;

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { name: body.data.name, image: nextImage },
      select: { id: true, name: true, email: true, image: true, isOwner: true },
    });

    if (before && before.name !== updated.name) {
      await logActivity(user, {
        action: 'profile.update',
        summary: `mudou o próprio nome de ${quoted(before.name ?? user.email)} para ${quoted(updated.name)}`,
        entityType: 'user',
        entityId: user.id,
      });
    }
    if (before && before.image !== nextImage) {
      await logActivity(user, {
        action: 'profile.update',
        summary: nextImage ? 'trocou a foto do perfil' : 'removeu a foto do perfil',
        entityType: 'user',
        entityId: user.id,
      });
    }

    return ok({ profile: updated });
  });
}
