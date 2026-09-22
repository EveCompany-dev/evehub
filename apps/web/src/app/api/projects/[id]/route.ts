import { prisma } from '@eve/core';
import { strings } from '@eve/ui';
import { z } from 'zod';
import { logActivity, quoted } from '../../../../lib/activity';
import { fail, handle, ok } from '../../../../lib/api';
import { requireProject } from '../../../../lib/jobs';
import { PROJECT_JOBS_INCLUDE } from '../../../../lib/projects';
import { requireUser } from '../../../../lib/session';

export const runtime = 'nodejs';

const patchSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(4000).nullable().optional(),
  date: z.string().datetime().nullable().optional(),
});

/** The project "folder": its own metadata, plus every job linked to it — and through those, their tasks, comments, and attachments, all in one payload. */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await context.params;
    const project = await requireProject(id, user.workspaceId);

    const [client, jobs] = await Promise.all([
      prisma.client.findUnique({ where: { id: project.clientId }, select: { id: true, name: true } }),
      prisma.job.findMany({
        where: { projectId: id },
        orderBy: { createdAt: 'desc' },
        include: PROJECT_JOBS_INCLUDE,
      }),
    ]);

    return ok({ project: { ...project, client }, jobs });
  });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await context.params;
    const existing = await requireProject(id, user.workspaceId);

    const body = patchSchema.safeParse(await request.json());
    if (!body.success) return fail(400, strings.errors.invalidPayload);
    const { title, description, date } = body.data;

    if (title !== undefined || description !== undefined || date !== undefined) {
      await prisma.project.update({
        where: { id },
        data: {
          ...(title !== undefined ? { title } : {}),
          ...(description !== undefined ? { description } : {}),
          ...(date !== undefined ? { date: date ? new Date(date) : null } : {}),
        },
      });
      await logActivity(user, {
        action: 'project.update',
        summary:
          title !== undefined && title !== existing.title
            ? `renomeou o projeto ${quoted(existing.title)} para ${quoted(title)}`
            : `editou o projeto ${quoted(existing.title)}`,
        entityType: 'project',
        entityId: id,
      });
    }

    const project = await prisma.project.findUnique({ where: { id } });
    return ok({ project });
  });
}

/** Deleting a project only removes the folder — its jobs survive, just unlinked (Job.projectId is onDelete: SetNull). */
export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await context.params;
    const project = await requireProject(id, user.workspaceId);

    await prisma.project.delete({ where: { id } });
    await logActivity(user, {
      action: 'project.delete',
      summary: `apagou o projeto ${quoted(project.title)} (os jobs dele continuam, sem projeto)`,
      entityType: 'project',
      entityId: id,
    });
    return ok({ ok: true });
  });
}
