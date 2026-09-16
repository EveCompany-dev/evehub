import { prisma } from '@eve/core';
import { strings } from '@eve/ui';
import { z } from 'zod';
import { fail, handle, ok } from '../../../../../lib/api';
import { requireClient } from '../../../../../lib/jobs';
import { requireUser } from '../../../../../lib/session';

export const runtime = 'nodejs';

const createSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(4000).optional(),
  date: z.string().datetime().nullable().optional(),
});

/** Every project "folder" under this client, most recent reference date first. */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await context.params;
    await requireClient(id, user.workspaceId);

    const projects = await prisma.project.findMany({
      where: { clientId: id },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      include: { _count: { select: { jobs: true } } },
    });

    return ok({ projects });
  });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await context.params;
    await requireClient(id, user.workspaceId);

    const body = createSchema.safeParse(await request.json());
    if (!body.success) return fail(400, strings.errors.invalidPayload);

    const project = await prisma.project.create({
      data: {
        workspaceId: user.workspaceId,
        clientId: id,
        title: body.data.title,
        description: body.data.description || null,
        date: body.data.date ? new Date(body.data.date) : null,
        createdBy: user.id,
      },
      include: { _count: { select: { jobs: true } } },
    });

    return ok({ project }, 201);
  });
}
