import { prisma } from '@eve/core';
import { strings } from '@eve/ui';
import { z } from 'zod';
import { logActivity, quoted } from '../../../../../lib/activity';
import { fail, handle, ok } from '../../../../../lib/api';
import { isUniqueConstraintError, requireColumn } from '../../../../../lib/jobs';
import { canManageJobColumnColors } from '../../../../../lib/permissions';
import { requireUser } from '../../../../../lib/session';

export const runtime = 'nodejs';

const hexSchema = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Cor precisa ser hexadecimal, ex: #3B82F6.');

const patchSchema = z
  .object({
    name: z.string().trim().min(1).max(60).optional(),
    color: hexSchema.nullable().optional(),
    colorOpacity: z.number().min(0).max(1).nullable().optional(),
    borderColor: hexSchema.nullable().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: 'Nada para atualizar.' });

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await context.params;
    const existing = await requireColumn(id, user.workspaceId);

    const body = patchSchema.safeParse(await request.json());
    if (!body.success) return fail(400, strings.errors.invalidPayload);

    const { name, color, colorOpacity, borderColor } = body.data;
    // A cor vale para o workspace inteiro, entao so o owner grava — mas
    // renomear a coluna continua aberto pra quem sempre pode hoje.
    const changesColor = color !== undefined || colorOpacity !== undefined || borderColor !== undefined;
    if (changesColor && !canManageJobColumnColors(user)) return fail(403, strings.errors.notOwnerJobColumns);

    try {
      const column = await prisma.jobColumn.update({
        where: { id },
        data: {
          ...(name !== undefined ? { name } : {}),
          ...(color !== undefined ? { color } : {}),
          ...(colorOpacity !== undefined ? { colorOpacity } : {}),
          ...(borderColor !== undefined ? { borderColor } : {}),
        },
      });
      if (name !== undefined && name !== existing.name) {
        await logActivity(user, { action: 'job.column', summary: `renomeou a coluna ${quoted(existing.name)} para ${quoted(name)}`, entityType: 'jobColumn', entityId: id });
      }
      if (changesColor) {
        await logActivity(user, { action: 'job.column', summary: `mudou a cor da coluna ${quoted(column.name)}`, entityType: 'jobColumn', entityId: id });
      }
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
    const column = await requireColumn(id, user.workspaceId);

    const jobCount = await prisma.job.count({ where: { columnId: id } });
    if (jobCount > 0) {
      return fail(409, `Essa coluna ainda tem ${jobCount} job(s). Mova ou apague-os antes de remover a coluna.`);
    }

    await prisma.jobColumn.delete({ where: { id } });
    await logActivity(user, { action: 'job.column', summary: `apagou a coluna ${quoted(column.name)} do quadro de jobs`, entityType: 'jobColumn', entityId: id });
    return ok({ ok: true });
  });
}
