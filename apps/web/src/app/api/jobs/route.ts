import { prisma } from '@eve/core';
import { strings } from '@eve/ui';
import { z } from 'zod';
import { logActivity, quoted } from '../../../lib/activity';
import { fail, handle, ok } from '../../../lib/api';
import { activeJobsWhere, JOB_INCLUDE, purgeExpiredJobs, trashExpiresAt } from '../../../lib/jobs';
import { canManageJobLifecycle } from '../../../lib/permissions';
import { HttpError, requireUser } from '../../../lib/session';

export const runtime = 'nodejs';

const createSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(4000).optional(),
  dueDate: z.string().datetime().nullable().optional(),
  /** Omitted: the board's first column. */
  columnId: z.string().min(1).optional(),
  clientId: z.string().min(1).nullable().optional(),
  responsibleId: z.string().min(1).nullable().optional(),
  collaboratorUserIds: z.array(z.string().min(1)).max(50).default([]),
  /** "Duplicar para outros clientes": one more copy of the job per client listed here. */
  duplicateClientIds: z.array(z.string().min(1)).max(100).default([]),
});

const VIEWS = ['active', 'concluded', 'trash'] as const;
type View = (typeof VIEWS)[number];

/**
 * The board's jobs (`?view=active`, the default), with tasks and
 * collaborators eager-loaded — one payload for the whole board. Admins can
 * also list the concluded ones (`?view=concluded`) and the trash
 * (`?view=trash`, which first removes what is past its 7 days).
 */
export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();
    const requested = new URL(request.url).searchParams.get('view') ?? 'active';
    if (!VIEWS.includes(requested as View)) return fail(400, strings.errors.invalidPayload);
    const view = requested as View;
    if (view !== 'active' && !canManageJobLifecycle(user)) throw new HttpError(403, strings.errors.notAdminJobs);

    if (view === 'trash') {
      await purgeExpiredJobs(user.workspaceId);
      const jobs = await prisma.job.findMany({
        where: { workspaceId: user.workspaceId, deletedAt: { not: null } },
        orderBy: { deletedAt: 'desc' },
        include: JOB_INCLUDE,
      });
      return ok({ jobs: jobs.map((job) => ({ ...job, trashExpiresAt: trashExpiresAt(job.deletedAt!) })) });
    }

    const jobs = await prisma.job.findMany({
      where:
        view === 'concluded'
          ? { workspaceId: user.workspaceId, deletedAt: null, concludedAt: { not: null } }
          : activeJobsWhere(user.workspaceId),
      orderBy: view === 'concluded' ? [{ concludedAt: 'desc' }] : [{ columnId: 'asc' }, { position: 'asc' }],
      include: JOB_INCLUDE,
    });

    return ok({ jobs });
  });
}

export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();

    const body = createSchema.safeParse(await request.json());
    if (!body.success) return fail(400, strings.errors.invalidPayload);

    const column = body.data.columnId
      ? await prisma.jobColumn.findUnique({ where: { id: body.data.columnId } })
      : await prisma.jobColumn.findFirst({ where: { workspaceId: user.workspaceId }, orderBy: { position: 'asc' } });
    if (!column || column.workspaceId !== user.workspaceId) {
      throw new HttpError(404, 'Coluna não encontrada.');
    }

    const peopleIds = [...new Set([...body.data.collaboratorUserIds, ...(body.data.responsibleId ? [body.data.responsibleId] : [])])];
    if (peopleIds.length > 0) {
      const validCount = await prisma.user.count({ where: { id: { in: peopleIds }, workspaceId: user.workspaceId, disabledAt: null } });
      if (validCount !== peopleIds.length) return fail(400, 'Um ou mais colaboradores não pertencem a este workspace.');
    }

    // The main client first, then each extra one — one job per client, all alike.
    const clientIds = [...new Set([body.data.clientId ?? null, ...body.data.duplicateClientIds])];
    const realClientIds = clientIds.filter((id): id is string => id !== null);
    if (realClientIds.length > 0) {
      const clients = await prisma.client.count({ where: { id: { in: realClientIds }, workspaceId: user.workspaceId } });
      if (clients !== realClientIds.length) return fail(400, 'Um ou mais clientes não pertencem a este workspace.');
    }

    const collaboratorIds = [...new Set(body.data.collaboratorUserIds)];
    const jobs = await prisma.$transaction(async (tx) => {
      const top = await tx.job.aggregate({ where: { columnId: column.id }, _max: { position: true } });
      let position = (top._max.position ?? -1) + 1;
      const created = [];
      for (const clientId of clientIds) {
        created.push(
          await tx.job.create({
            data: {
              workspaceId: user.workspaceId,
              columnId: column.id,
              position: position++,
              title: body.data.title,
              description: body.data.description || null,
              dueDate: body.data.dueDate ? new Date(body.data.dueDate) : null,
              clientId,
              responsibleId: body.data.responsibleId ?? null,
              createdBy: user.id,
              collaborators: { create: collaboratorIds.map((userId) => ({ userId })) },
            },
            include: JOB_INCLUDE,
          }),
        );
      }
      return created;
    });

    for (const job of jobs) {
      await logActivity(user, {
        action: 'job.create',
        summary: `criou o job ${quoted(job.title)} em ${quoted(column.name)}${job.client ? ` para ${quoted(job.client.name)}` : ''}`,
        entityType: 'job',
        entityId: job.id,
      });
    }

    return ok({ job: jobs[0], jobs }, 201);
  });
}
