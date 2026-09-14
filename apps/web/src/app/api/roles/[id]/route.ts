import { prisma } from '@eve/core';
import { strings } from '@eve/ui';
import { z } from 'zod';
import { fail, handle, ok } from '../../../../lib/api';
import { canManageTeam, TAB_KEYS } from '../../../../lib/permissions';
import { HttpError, requireUser } from '../../../../lib/session';

export const runtime = 'nodejs';

const patchSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  tabs: z.array(z.string()).optional(),
});

function cleanTabs(tabs: string[]): string[] {
  return tabs.filter((tab) => (TAB_KEYS as readonly string[]).includes(tab));
}

async function requireRole(id: string, workspaceId: string) {
  const role = await prisma.role.findUnique({ where: { id } });
  if (!role || role.workspaceId !== workspaceId) throw new HttpError(404, strings.errors.notFound);
  return role;
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();
    if (!canManageTeam(user)) throw new HttpError(403, strings.errors.notOwnerTeam);

    const { id } = await context.params;
    await requireRole(id, user.workspaceId);

    const body = patchSchema.safeParse(await request.json());
    if (!body.success) return fail(400, strings.errors.invalidPayload);

    const role = await prisma.role.update({
      where: { id },
      data: {
        ...(body.data.name !== undefined ? { name: body.data.name } : {}),
        ...(body.data.tabs !== undefined ? { tabs: cleanTabs(body.data.tabs) } : {}),
      },
    });

    return ok({ role });
  });
}

/** Users with this Role fall back to the default tab set (SetNull), not locked out entirely. */
export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();
    if (!canManageTeam(user)) throw new HttpError(403, strings.errors.notOwnerTeam);

    const { id } = await context.params;
    await requireRole(id, user.workspaceId);

    await prisma.role.delete({ where: { id } });
    return ok({ ok: true });
  });
}
