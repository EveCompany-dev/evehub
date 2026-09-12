import { prisma } from '@eve/core';
import { strings } from '@eve/ui';
import { handle, ok } from '../../../../lib/api';
import { canViewScheduling } from '../../../../lib/permissions';
import { HttpError, requireUser } from '../../../../lib/session';

export const runtime = 'nodejs';

/** Connected Meta (Page/Instagram) instances, for the post composer's account picker. */
export async function GET(): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();
    if (!canViewScheduling(user)) throw new HttpError(403, strings.errors.notAllowedScheduling);

    const instances = await prisma.connectorInstance.findMany({
      where: { workspaceId: user.workspaceId, connectorId: 'meta' },
      select: { id: true, label: true, status: true, config: true },
    });

    return ok({
      accounts: instances.map((instance) => ({
        id: instance.id,
        label: instance.label,
        status: instance.status,
        hasInstagram: Boolean((instance.config as { instagramBusinessAccountId?: string }).instagramBusinessAccountId),
      })),
    });
  });
}
