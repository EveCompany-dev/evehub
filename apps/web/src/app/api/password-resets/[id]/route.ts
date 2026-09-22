import { prisma } from '@eve/core';
import { strings } from '@eve/ui';
import { logActivity, personLabel } from '../../../../lib/activity';
import { handle, ok } from '../../../../lib/api';
import { canManageTeam } from '../../../../lib/permissions';
import { HttpError, requireUser } from '../../../../lib/session';

export const runtime = 'nodejs';

/**
 * Descarta um pedido de senha sem gerar link — o admin nao reconhece o
 * pedido, ou ja resolveu por outro caminho. Somente admin.
 */
export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = await requireUser();
    if (!canManageTeam(actor)) throw new HttpError(403, strings.errors.notOwnerTeam);

    const { id } = await context.params;
    const request = await prisma.passwordResetRequest.findUnique({
      where: { id },
      select: { id: true, workspaceId: true, dismissedAt: true, usedAt: true, user: { select: { id: true, name: true, email: true } } },
    });
    if (!request || request.workspaceId !== actor.workspaceId) throw new HttpError(404, strings.errors.notFound);

    if (!request.dismissedAt && !request.usedAt) {
      await prisma.passwordResetRequest.update({ where: { id }, data: { dismissedAt: new Date() } });
      await logActivity(actor, {
        action: 'user.passwordResetDismissed',
        summary: `descartou o pedido de redefinição de senha de ${personLabel(request.user)}`,
        entityType: 'user',
        entityId: request.user.id,
      });
    }

    return ok({ ok: true });
  });
}
