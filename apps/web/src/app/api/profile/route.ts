import { prisma } from '@eve/core';
import { strings } from '@eve/ui';
import { z } from 'zod';
import { fail, handle, ok } from '../../../lib/api';
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

    // E-mail is the login identity, so a collision has to be a clear error
    // rather than a raw unique-constraint failure.
    if (email !== user.email.toLowerCase()) {
      const taken = await prisma.user.findUnique({ where: { email }, select: { id: true } });
      if (taken && taken.id !== user.id) return fail(409, 'Esse e-mail já está em uso por outra conta.');
    }

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: {
        name: body.data.name,
        email,
        image: body.data.image ? body.data.image : null,
      },
      select: { id: true, name: true, email: true, image: true, isOwner: true },
    });

    return ok({ profile: updated });
  });
}
