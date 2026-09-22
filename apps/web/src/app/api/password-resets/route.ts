import { prisma } from '@eve/core';
import { strings } from '@eve/ui';
import { handle, ok } from '../../../lib/api';
import { canManageTeam } from '../../../lib/permissions';
import { pendingRequestWhere } from '../../../lib/password-reset';
import { HttpError, requireUser } from '../../../lib/session';

export const runtime = 'nodejs';

/** Pedidos de "esqueci minha senha" ainda sem resposta. Somente admin. */
export async function GET(): Promise<Response> {
  return handle(async () => {
    const actor = await requireUser();
    if (!canManageTeam(actor)) throw new HttpError(403, strings.errors.notOwnerTeam);

    const requests = await prisma.passwordResetRequest.findMany({
      where: { workspaceId: actor.workspaceId, ...pendingRequestWhere(), user: { disabledAt: null } },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        createdAt: true,
        user: { select: { id: true, name: true, email: true, image: true } },
      },
    });

    return ok({
      requests: requests.map((row) => ({ id: row.id, createdAt: row.createdAt.toISOString(), user: row.user })),
    });
  });
}
