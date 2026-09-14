import { prisma } from '@eve/core';
import { strings } from '@eve/ui';
import { z } from 'zod';
import { fail, handle, ok } from '../../../../lib/api';
import { canViewFinancial } from '../../../../lib/permissions';
import { HttpError, requireUser } from '../../../../lib/session';

export const runtime = 'nodejs';

const createSchema = z.object({
  type: z.enum(['income', 'expense']),
  description: z.string().trim().min(1).max(200),
  amountCents: z.number().int().positive(),
  date: z.string().datetime(),
  clientId: z.string().min(1).nullable().optional(),
  jobId: z.string().min(1).nullable().optional(),
});

async function requireOwnerWorkspace(): Promise<{ id: string; workspaceId: string }> {
  const user = await requireUser();
  // requireUser() already reflects a fresh DB read (see auth.ts's session
  // callback) — no need for a second prisma.user.findUnique just for this check.
  if (!canViewFinancial(user)) throw new HttpError(403, strings.errors.notOwnerFinancial);
  return user;
}

export async function GET(): Promise<Response> {
  return handle(async () => {
    const user = await requireOwnerWorkspace();
    const entries = await prisma.financialEntry.findMany({
      where: { workspaceId: user.workspaceId },
      orderBy: { date: 'desc' },
      include: { client: { select: { id: true, name: true } }, job: { select: { id: true, title: true } } },
      take: 500,
    });
    return ok({ entries });
  });
}

export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    const user = await requireOwnerWorkspace();

    const body = createSchema.safeParse(await request.json());
    if (!body.success) return fail(400, strings.errors.invalidPayload);

    if (body.data.clientId) {
      const client = await prisma.client.findUnique({ where: { id: body.data.clientId } });
      if (!client || client.workspaceId !== user.workspaceId) throw new HttpError(404, strings.errors.notFound);
    }
    if (body.data.jobId) {
      const job = await prisma.job.findUnique({ where: { id: body.data.jobId } });
      if (!job || job.workspaceId !== user.workspaceId) throw new HttpError(404, strings.errors.notFound);
    }

    const entry = await prisma.financialEntry.create({
      data: {
        workspaceId: user.workspaceId,
        type: body.data.type,
        description: body.data.description,
        amountCents: body.data.amountCents,
        date: new Date(body.data.date),
        clientId: body.data.clientId ?? null,
        jobId: body.data.jobId ?? null,
        createdBy: user.id,
      },
      include: { client: { select: { id: true, name: true } }, job: { select: { id: true, title: true } } },
    });

    return ok({ entry }, 201);
  });
}
