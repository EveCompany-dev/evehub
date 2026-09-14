import { prisma } from '@eve/core';
import { strings } from '@eve/ui';
import { z } from 'zod';
import { fail, handle, ok } from '../../../../lib/api';
import { canViewScheduling } from '../../../../lib/permissions';
import { HttpError, requireUser } from '../../../../lib/session';

export const runtime = 'nodejs';

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  notes: z.string().trim().max(2000).optional(),
});

/**
 * Local client list for the scheduling filter/composer (and everywhere else
 * that reuses this endpoint — Data Tables' client column, job description
 * mentions, Financeiro, chat @mentions). `source: 'local'` stays on every
 * row even though Notion is gone, so those existing `.filter(c => c.source
 * === 'local')` call sites keep working unchanged.
 */
export async function GET(): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();
    if (!canViewScheduling(user)) throw new HttpError(403, strings.errors.notAllowedScheduling);

    const local = await prisma.client.findMany({ where: { workspaceId: user.workspaceId }, orderBy: { name: 'asc' } });

    return ok({
      clients: local.map((client) => ({
        source: 'local' as const,
        id: client.id,
        label: client.name,
        notes: client.notes,
        createdAt: client.createdAt,
      })),
    });
  });
}

/** Creates a local client. */
export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();
    if (!canViewScheduling(user)) throw new HttpError(403, strings.errors.notAllowedScheduling);

    const body = createSchema.safeParse(await request.json());
    if (!body.success) return fail(400, strings.errors.invalidPayload);

    const client = await prisma.client.create({
      data: { workspaceId: user.workspaceId, name: body.data.name, notes: body.data.notes ?? null },
    });

    return ok({ client }, 201);
  });
}
