import { prisma } from '@eve/core';
import { handle, ok } from '../../../../lib/api';
import { requireUser } from '../../../../lib/session';

export const runtime = 'nodejs';

/**
 * Every active member of the workspace — deliberately minimal (id/name/email/
 * image only) and open to any authenticated user, unlike /api/users (owner-
 * only, exposes password/disabled status for real team management). This is
 * just "who can I pick as a collaborator", not team administration.
 */
export async function GET(): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();

    const members = await prisma.user.findMany({
      where: { workspaceId: user.workspaceId, disabledAt: null },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, email: true, image: true },
    });

    return ok({ members });
  });
}
