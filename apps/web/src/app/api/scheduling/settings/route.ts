import { prisma } from '@eve/core';
import { strings } from '@eve/ui';
import { z } from 'zod';
import { fail, handle, ok } from '../../../../lib/api';
import { canViewScheduling } from '../../../../lib/permissions';
import { HttpError, requireUser } from '../../../../lib/session';

export const runtime = 'nodejs';

const patchSchema = z.object({ clientSourceInstanceId: z.string().nullable() });

/** Which Notion instance (if any) feeds the client filter, plus the candidates. */
export async function GET(): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();
    if (!canViewScheduling(user)) throw new HttpError(403, strings.errors.notAllowedScheduling);

    const [workspace, notionInstances] = await Promise.all([
      prisma.workspace.findUnique({ where: { id: user.workspaceId }, select: { clientSourceInstanceId: true } }),
      prisma.connectorInstance.findMany({
        where: { workspaceId: user.workspaceId, connectorId: 'notion' },
        select: { id: true, label: true },
      }),
    ]);

    return ok({ clientSourceInstanceId: workspace?.clientSourceInstanceId ?? null, notionInstances });
  });
}

export async function PATCH(request: Request): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();
    if (!canViewScheduling(user)) throw new HttpError(403, strings.errors.notAllowedScheduling);

    const body = patchSchema.safeParse(await request.json());
    if (!body.success) return fail(400, strings.errors.invalidPayload);

    if (body.data.clientSourceInstanceId) {
      const instance = await prisma.connectorInstance.findUnique({ where: { id: body.data.clientSourceInstanceId } });
      if (!instance || instance.workspaceId !== user.workspaceId || instance.connectorId !== 'notion') {
        return fail(400, strings.errors.invalidPayload);
      }
    }

    await prisma.workspace.update({
      where: { id: user.workspaceId },
      data: { clientSourceInstanceId: body.data.clientSourceInstanceId },
    });

    return ok({ clientSourceInstanceId: body.data.clientSourceInstanceId });
  });
}
