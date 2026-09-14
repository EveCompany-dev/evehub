import { hashPassword, prisma, verifyPassword } from '@eve/core';
import { z } from 'zod';
import { fail, handle, ok } from '../../../../lib/api';
import { requireUser } from '../../../../lib/session';

export const runtime = 'nodejs';

const passwordSchema = z.object({
  currentPassword: z.string().optional(),
  newPassword: z.string().min(8, 'A nova senha precisa de pelo menos 8 caracteres.').max(200),
});

/**
 * Troca a senha.
 *
 * Nao existe endpoint para *ler* a senha: ela e guardada como hash argon2id,
 * que e irreversivel por design. Uma conta que so entra pelo Google ainda nao
 * tem senha, e nesse caso define uma sem exigir a anterior.
 *
 * Sem 2FA por enquanto, como combinado — quando entrar, e aqui que o segundo
 * fator e verificado antes do update.
 */
export async function PUT(request: Request): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();

    const body = passwordSchema.safeParse(await request.json());
    if (!body.success) {
      return fail(400, body.error.issues.map((issue) => issue.message).join('; '));
    }

    const row = await prisma.user.findUnique({ where: { id: user.id }, select: { passwordHash: true } });
    if (!row) return fail(404, 'Usuário não encontrado.');

    if (row.passwordHash) {
      if (!body.data.currentPassword) return fail(400, 'Informe a senha atual.');
      if (!(await verifyPassword(row.passwordHash, body.data.currentPassword))) {
        return fail(403, 'Senha atual incorreta.');
      }
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(body.data.newPassword) },
    });

    return ok({ ok: true, hasPassword: true });
  });
}
