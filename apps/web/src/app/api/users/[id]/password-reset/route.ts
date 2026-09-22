import { prisma } from '@eve/core';
import { strings } from '@eve/ui';
import { logActivity, personLabel } from '../../../../../lib/activity';
import { fail, handle, ok } from '../../../../../lib/api';
import { canManageTeam } from '../../../../../lib/permissions';
import { generateResetToken, pendingRequestWhere, RESET_LINK_TTL_MS, resetLinkPath } from '../../../../../lib/password-reset';
import { HttpError, requireUser } from '../../../../../lib/session';

export const runtime = 'nodejs';

/**
 * Gera o link de redefinicao de senha de alguem. Somente admin.
 *
 * Responde o caminho do link (o token so existe aqui, nunca mais legivel), e
 * o admin entrega por fora. Se a pessoa tinha um pedido aberto, este link o
 * responde; qualquer link anterior ainda nao usado deixa de valer.
 */
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = await requireUser();
    if (!canManageTeam(actor)) throw new HttpError(403, strings.errors.notOwnerTeam);

    const { id } = await context.params;

    const target = await prisma.user.findUnique({
      where: { id },
      select: { id: true, name: true, email: true, workspaceId: true, disabledAt: true, deletedAt: true },
    });
    if (!target || target.workspaceId !== actor.workspaceId || target.deletedAt) {
      throw new HttpError(404, strings.errors.notFound);
    }
    if (target.id === actor.id) return fail(409, 'Troque a sua própria senha no seu perfil.');
    if (target.disabledAt) return fail(409, 'Esta conta está desativada. Reative antes de gerar um link de senha.');

    const { token, tokenHash } = generateResetToken();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + RESET_LINK_TTL_MS);

    const request = await prisma.$transaction(async (tx) => {
      const open = await tx.passwordResetRequest.findFirst({
        where: { userId: target.id, ...pendingRequestWhere(now) },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      });

      const issued = { tokenHash, tokenExpiresAt: expiresAt, issuedById: actor.id, issuedAt: now };
      const saved = open
        ? await tx.passwordResetRequest.update({ where: { id: open.id }, data: issued, select: { id: true } })
        : await tx.passwordResetRequest.create({
            data: { workspaceId: actor.workspaceId, userId: target.id, ...issued },
            select: { id: true },
          });

      await tx.passwordResetRequest.updateMany({
        where: { userId: target.id, id: { not: saved.id }, usedAt: null, dismissedAt: null },
        data: { dismissedAt: now },
      });

      return { ...saved, answeredRequest: Boolean(open) };
    });

    await logActivity(actor, {
      action: 'user.passwordResetLink',
      summary: request.answeredRequest
        ? `gerou o link de redefinição de senha que ${personLabel(target)} pediu`
        : `gerou um link de redefinição de senha para ${personLabel(target)}`,
      entityType: 'user',
      entityId: target.id,
    });

    return ok({ path: resetLinkPath(token), expiresAt: expiresAt.toISOString() }, 201);
  });
}
