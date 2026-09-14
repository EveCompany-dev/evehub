import { prisma } from '@eve/core';
import { handle, ok } from '../../../../lib/api';
import { requireUser } from '../../../../lib/session';

export const runtime = 'nodejs';

export async function POST(): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();
    await prisma.notification.updateMany({ where: { userId: user.id, readAt: null }, data: { readAt: new Date() } });
    return ok({ ok: true });
  });
}
