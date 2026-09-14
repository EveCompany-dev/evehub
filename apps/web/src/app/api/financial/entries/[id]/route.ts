import { prisma } from '@eve/core';
import { strings } from '@eve/ui';
import { z } from 'zod';
import { fail, handle, ok } from '../../../../../lib/api';
import { canViewFinancial } from '../../../../../lib/permissions';
import { HttpError, requireUser } from '../../../../../lib/session';

export const runtime = 'nodejs';

const patchSchema = z.object({
  type: z.enum(['income', 'expense']).optional(),
  description: z.string().trim().min(1).max(200).optional(),
  amountCents: z.number().int().positive().optional(),
  date: z.string().datetime().optional(),
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

async function requireEntry(id: string, workspaceId: string) {
  const entry = await prisma.financialEntry.findUnique({ where: { id } });
  if (!entry || entry.workspaceId !== workspaceId) throw new HttpError(404, strings.errors.notFound);
  return entry;
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const user = await requireOwnerWorkspace();
    const { id } = await context.params;
    await requireEntry(id, user.workspaceId);

    const body = patchSchema.safeParse(await request.json());
    if (!body.success) return fail(400, strings.errors.invalidPayload);

    if (body.data.clientId) {
      const client = await prisma.client.findUnique({ where: { id: body.data.clientId } });
      if (!client || client.workspaceId !== user.workspaceId) throw new HttpError(404, strings.errors.notFound);
    }
    if (body.data.jobId) {
      const job = await prisma.job.findUnique({ where: { id: body.data.jobId } });
      if (!job || job.workspaceId !== user.workspaceId) throw new HttpError(404, strings.errors.notFound);
    }

    const { type, description, amountCents, date, clientId, jobId } = body.data;
    const entry = await prisma.financialEntry.update({
      where: { id },
      data: {
        ...(type !== undefined ? { type } : {}),
        ...(description !== undefined ? { description } : {}),
        ...(amountCents !== undefined ? { amountCents } : {}),
        ...(date !== undefined ? { date: new Date(date) } : {}),
        ...(clientId !== undefined ? { clientId } : {}),
        ...(jobId !== undefined ? { jobId } : {}),
      },
      include: { client: { select: { id: true, name: true } }, job: { select: { id: true, title: true } } },
    });

    return ok({ entry });
  });
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const user = await requireOwnerWorkspace();
    const { id } = await context.params;
    await requireEntry(id, user.workspaceId);

    await prisma.financialEntry.delete({ where: { id } });
    return ok({ ok: true });
  });
}
