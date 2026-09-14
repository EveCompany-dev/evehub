import { prisma } from '@eve/core';
import { handle, ok } from '../../../lib/api';
import { requireUser } from '../../../lib/session';

export const runtime = 'nodejs';

const RECENT_LIMIT = 30;
const MAX_LIMIT = 200;

/** The bell dropdown requests the default (last 30); the full /notifications page asks for more via ?limit=. */
export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();

    const requested = Number(new URL(request.url).searchParams.get('limit'));
    const take = Number.isFinite(requested) && requested > 0 ? Math.min(requested, MAX_LIMIT) : RECENT_LIMIT;

    const [notifications, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: 'desc' },
        take,
        include: { job: { select: { id: true, title: true } } },
      }),
      prisma.notification.count({ where: { userId: user.id, readAt: null } }),
    ]);

    return ok({ notifications, unreadCount });
  });
}
