import { prisma } from '@eve/core';
import { strings } from '@eve/ui';
import { z } from 'zod';
import { fail, handle, ok } from '../../../../../lib/api';
import { isUniqueConstraintError, requireColumn } from '../../../../../lib/jobs';
import { requireUser } from '../../../../../lib/session';

export const runtime = 'nodejs';

const patchSchema = z.object({ name: z.string().trim().min(1).max(60) });

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await context.params;
    await requireColumn(id, user.workspaceId);

    const body = patchSchema.safeParse(await request.json());
    if (!body.success) return fail(400, strings.errors.invalidPayload);

    try {
      const column = await prisma.jobColumn.update({ where: { id }, data: { name: body.data.name } });
      return ok({ column });
    } catch (error) {
      if (isUniqueConstraintError(error)) return fail(409, 'Ja existe uma coluna com esse nome.');
      throw error;
    }
  });
}

/** Blocked while the column still holds jobs — no job may ever point at a deleted column. */
export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await context.params;
    await requireColumn(id, user.workspaceId);

    const jobCount = await prisma.job.count({ where: { columnId: id } });
    if (jobCount > 0) {
      return fail(409, `Essa coluna ainda tem ${jobCount} job(s). Mova ou apague-os antes de remover a coluna.`);
    }

    await prisma.jobColumn.delete({ where: { id } });
    return ok({ ok: true });
  });
}
