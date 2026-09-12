import { prisma } from '@eve/core';
import { strings } from '@eve/ui';
import { z } from 'zod';
import { fail, handle, ok } from '../../../../lib/api';
import { canViewScheduling } from '../../../../lib/permissions';
import { HttpError, requireUser } from '../../../../lib/session';
import { listNotionClients } from '../notion-clients';

export const runtime = 'nodejs';

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  notes: z.string().trim().max(2000).optional(),
});

/** Merged client list for the scheduling filter/composer: local rows + whatever Notion source is configured. */
export async function GET(): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();
    if (!canViewScheduling(user)) throw new HttpError(403, strings.errors.notAllowedScheduling);

    const [local, notion] = await Promise.all([
      prisma.client.findMany({ where: { workspaceId: user.workspaceId }, orderBy: { name: 'asc' } }),
      listNotionClients(user.workspaceId),
    ]);

    return ok({
      clients: [
        ...local.map((client) => ({ source: 'local' as const, id: client.id, label: client.name })),
        ...notion,
      ],
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
