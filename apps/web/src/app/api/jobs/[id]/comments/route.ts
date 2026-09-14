import { prisma } from '@eve/core';
import { strings } from '@eve/ui';
import { z } from 'zod';
import { fail, handle, ok } from '../../../../../lib/api';
import { JOB_MEMBER_SELECT, requireJob } from '../../../../../lib/jobs';
import { requireUser } from '../../../../../lib/session';

export const runtime = 'nodejs';

const createSchema = z.object({ body: z.string().trim().min(1).max(4000) });

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await context.params;
    await requireJob(id, user.workspaceId);

    const comments = await prisma.jobComment.findMany({
      where: { jobId: id },
      orderBy: { createdAt: 'asc' },
      include: { author: { select: JOB_MEMBER_SELECT } },
    });

    return ok({ comments });
  });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await context.params;
    await requireJob(id, user.workspaceId);

    const body = createSchema.safeParse(await request.json());
    if (!body.success) return fail(400, strings.errors.invalidPayload);

    const comment = await prisma.jobComment.create({
      data: { jobId: id, authorId: user.id, body: body.data.body },
      include: { author: { select: JOB_MEMBER_SELECT } },
    });

    return ok({ comment }, 201);
  });
}
