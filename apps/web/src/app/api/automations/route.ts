import { prisma } from '@eve/core';
import { handle, ok } from '../../../lib/api';
import { requireUser } from '../../../lib/session';

export const runtime = 'nodejs';

/** Recent automation log entries for the workspace — open to any authenticated user, same as the page itself. */
export async function GET(): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();
    const logs = await prisma.automationLog.findMany({
      where: { workspaceId: user.workspaceId },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return ok({ logs });
  });
}
