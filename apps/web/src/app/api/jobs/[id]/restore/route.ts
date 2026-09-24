import { prisma } from '@eve/core';
import { strings } from '@eve/ui';
import { logActivity, quoted } from '../../../../../lib/activity';
import { fail, handle, ok } from '../../../../../lib/api';
import { JOB_INCLUDE, requireJob } from '../../../../../lib/jobs';
import { canManageJobLifecycle } from '../../../../../lib/permissions';
import { HttpError, requireUser } from '../../../../../lib/session';

export const runtime = 'nodejs';

/** Admin-only: takes a job out of the trash, back to the bottom of its column. */
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();
    if (!canManageJobLifecycle(user)) throw new HttpError(403, strings.errors.notAdminJobs);
    const { id } = await context.params;
    const job = await requireJob(id, user, { allowTrashed: true });
    if (!job.deletedAt) return fail(409, 'Esse job não está na lixeira.');

    const top = await prisma.job.aggregate({ where: { columnId: job.columnId, deletedAt: null, concludedAt: null }, _max: { position: true } });
    const restored = await prisma.job.update({
      where: { id },
      data: { deletedAt: null, deletedBy: null, position: (top._max.position ?? -1) + 1 },
      include: JOB_INCLUDE,
    });
    await logActivity(user, { action: 'job.restore', summary: `restaurou o job ${quoted(job.title)} da lixeira`, entityType: 'job', entityId: id });
    return ok({ job: restored });
  });
}
