import { prisma } from '@eve/core';
import { handle, ok } from '../../../../lib/api';
import { requireClient } from '../../../../lib/jobs';
import { requireUser } from '../../../../lib/session';

export const runtime = 'nodejs';

/** A single client's own page (its projects, and everything attached through them) — any authenticated workspace member, same as the Jobs board they link from. */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await context.params;
    const client = await requireClient(id, user.workspaceId);

    const [projectCount, jobCount, unassignedJobs] = await Promise.all([
      prisma.project.count({ where: { clientId: id } }),
      prisma.job.count({ where: { clientId: id } }),
      // Jobs linked straight to the client but not filed into any project
      // folder yet — surfaced on the client page so they aren't invisible
      // until someone files them.
      prisma.job.findMany({
        where: { clientId: id, projectId: null },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          title: true,
          dueDate: true,
          important: true,
          columnId: true,
          column: { select: { name: true } },
        },
      }),
    ]);

    return ok({
      client: { ...client, projectCount, jobCount },
      unassignedJobs: unassignedJobs.map((job) => ({
        id: job.id,
        title: job.title,
        dueDate: job.dueDate,
        important: job.important,
        columnId: job.columnId,
        columnName: job.column.name,
      })),
    });
  });
}
