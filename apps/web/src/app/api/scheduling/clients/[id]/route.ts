import { prisma } from '@eve/core';
import { strings } from '@eve/ui';
import { z } from 'zod';
import { logActivity, quoted } from '../../../../../lib/activity';
import { fail, handle, ok } from '../../../../../lib/api';
import { canViewScheduling } from '../../../../../lib/permissions';
import { clientProfileOut, parseClientProfile } from '../../../../../lib/client-fields';
import { HttpError, requireUser } from '../../../../../lib/session';

export const runtime = 'nodejs';

const patchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .nullable()
    .optional(),
  icon: z.string().trim().max(8).nullable().optional(),
  logoUrl: z.string().max(500).startsWith('/uploads/').nullable().optional(),
});

async function requireLocalClient(id: string, workspaceId: string) {
  const client = await prisma.client.findUnique({ where: { id } });
  if (!client || client.workspaceId !== workspaceId) throw new HttpError(404, strings.errors.notFound);
  return client;
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();
    if (!canViewScheduling(user)) throw new HttpError(403, strings.errors.notAllowedScheduling);

    const { id } = await context.params;
    const before = await requireLocalClient(id, user.workspaceId);

    const raw: unknown = await request.json().catch(() => null);
    const body = patchSchema.safeParse(raw);
    if (!body.success) return fail(400, strings.errors.invalidPayload);
    const profile = parseClientProfile(raw, true);
    if (!profile.ok) return fail(400, profile.error);

    const client = await prisma.client.update({ where: { id }, data: { ...body.data, ...profile.data } });
    const fields = [...Object.keys(body.data), ...Object.keys(profile.data)];
    await logActivity(user, {
      action: 'client.update',
      summary:
        body.data.name !== undefined && body.data.name !== before.name
          ? `renomeou o cliente ${quoted(before.name)} para ${quoted(client.name)}`
          : `editou o cadastro do cliente ${quoted(client.name)}${fields.length > 0 ? ` (${fields.length} campo${fields.length === 1 ? '' : 's'})` : ''}`,
      entityType: 'client',
      entityId: id,
    });
    return ok({ client: { ...client, ...clientProfileOut(client) } });
  });
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();
    if (!canViewScheduling(user)) throw new HttpError(403, strings.errors.notAllowedScheduling);

    const { id } = await context.params;
    const client = await requireLocalClient(id, user.workspaceId);

    await prisma.client.delete({ where: { id } });
    await logActivity(user, { action: 'client.delete', summary: `apagou o cliente ${quoted(client.name)}`, entityType: 'client', entityId: id });
    return ok({ ok: true });
  });
}
