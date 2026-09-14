import { prisma } from '@eve/core';
import { handle, ok } from '../../../../../lib/api';
import { JOB_MEMBER_SELECT } from '../../../../../lib/jobs';
import { requireUser } from '../../../../../lib/session';

export const runtime = 'nodejs';

/**
 * The caller's single running timer (if any), anywhere on the board — not
 * scoped to one job. Powers the floating popup and the play/pause state on
 * whichever job/task modal happens to be open, since only one timer can run
 * per person at a time.
 */
export async function GET(): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();

    const entry = await prisma.timeEntry.findFirst({
      where: { userId: user.id, endedAt: null },
      include: {
        user: { select: JOB_MEMBER_SELECT },
        task: { select: { id: true, title: true } },
        job: { select: { id: true, title: true } },
      },
    });

    return ok({ entry });
  });
}
