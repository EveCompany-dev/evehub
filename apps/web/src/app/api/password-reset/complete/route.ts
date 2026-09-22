import { hashPassword, prisma } from '@eve/core';
import { z } from 'zod';
import { logAnonymousActivity } from '../../../../lib/activity';
import { fail, handle, ok } from '../../../../lib/api';
import { findUsableReset, RESET_LINK_INVALID } from '../../../../lib/password-reset';
import { clearLoginAttempts } from '../../../../lib/rate-limit';

export const runtime = 'nodejs';

const completeSchema = z.object({
  token: z.string().min(20).max(200),
  password: z.string().min(8, 'A nova senha precisa de pelo menos 8 caracteres.').max(200),
});

/**
 * Define a senha nova a partir do link que um admin gerou. Sem sessao: o
 * token e a prova. Uso unico — o pedido e reivindicado com um update
 * condicional, entao dois envios simultaneos do mesmo link nao passam os dois.
 */
export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    const body = completeSchema.safeParse(await request.json().catch(() => ({})));
    if (!body.success) {
      return fail(400, body.error.issues.map((issue) => issue.message).join('; '));
    }

    const reset = await findUsableReset(body.data.token);
    if (!reset) return fail(400, RESET_LINK_INVALID);

    const passwordHash = await hashPassword(body.data.password);
    const now = new Date();

    const claimed = await prisma.$transaction(async (tx) => {
      const claim = await tx.passwordResetRequest.updateMany({
        where: { id: reset.id, usedAt: null, dismissedAt: null },
        data: { usedAt: now },
      });
      if (claim.count === 0) return false;

      await tx.user.update({ where: { id: reset.user.id }, data: { passwordHash } });

      // Qualquer outro link ou pedido aberto desta pessoa perde a validade:
      // a senha ja foi resolvida.
      await tx.passwordResetRequest.updateMany({
        where: { userId: reset.user.id, id: { not: reset.id }, usedAt: null, dismissedAt: null },
        data: { dismissedAt: now },
      });
      return true;
    });

    if (!claimed) return fail(400, RESET_LINK_INVALID);

    // Quem errou a senha cinco vezes antes de pedir ajuda nao fica bloqueado
    // pelo rate limit logo depois de resolver.
    await clearLoginAttempts(reset.user.email);

    await logAnonymousActivity(reset.user.workspaceId, reset.user, {
      action: 'auth.passwordReset',
      summary: 'definiu uma senha nova pelo link de redefinição',
      entityType: 'user',
      entityId: reset.user.id,
    });

    return ok({ ok: true, email: reset.user.email });
  });
}
