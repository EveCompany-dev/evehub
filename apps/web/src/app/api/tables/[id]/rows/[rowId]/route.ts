import { dataColumnSchema, Prisma, prisma } from '@eve/core';
import { strings } from '@eve/ui';
import { z } from 'zod';
import { describeRow, logActivity, quoted } from '../../../../../../lib/activity';
import { fail, handle, ok } from '../../../../../../lib/api';
import { HttpError, requireUser } from '../../../../../../lib/session';

export const runtime = 'nodejs';

const patchSchema = z.object({ data: z.record(z.string(), z.unknown()) });

async function requireRow(tableId: string, rowId: string, workspaceId: string) {
  const table = await prisma.dataTable.findUnique({ where: { id: tableId } });
  if (!table || table.workspaceId !== workspaceId) throw new HttpError(404, strings.errors.notFound);

  const row = await prisma.dataTableRow.findUnique({ where: { id: rowId } });
  if (!row || row.tableId !== tableId) throw new HttpError(404, strings.errors.notFound);

  return { table, row };
}

/** Merges the given fields into the row — no optimistic lock, nothing external can race a local edit. */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string; rowId: string }> },
): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();
    const { id, rowId } = await context.params;
    const { table, row } = await requireRow(id, rowId, user.workspaceId);

    const body = patchSchema.safeParse(await request.json());
    if (!body.success) return fail(400, strings.errors.invalidPayload);

    const keys = new Set(z.array(dataColumnSchema).catch([]).parse(table.columns).map((column) => column.key));
    for (const key of Object.keys(body.data.data)) {
      if (!keys.has(key)) return fail(400, `A coluna "${key}" não existe nesta tabela.`);
    }

    const updated = await prisma.dataTableRow.update({
      where: { id: rowId },
      data: { data: { ...(row.data as Record<string, unknown>), ...body.data.data } as Prisma.InputJsonValue },
    });

    const before = (row.data ?? {}) as Record<string, unknown>;
    const changedKeys = Object.keys(body.data.data).filter((key) => JSON.stringify(before[key]) !== JSON.stringify(body.data.data[key]));
    if (changedKeys.length > 0) {
      const described = describeRow(table.columns, updated.data, changedKeys);
      await logActivity(user, {
        action: 'table.row.update',
        summary: `editou ${described.fields} na linha ${described.title} da tabela ${quoted(table.name)}`,
        entityType: 'table',
        entityId: id,
        details: { rowId, fields: changedKeys },
      });
    }

    return ok({ row: updated });
  });
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string; rowId: string }> },
): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();
    const { id, rowId } = await context.params;
    const { table, row } = await requireRow(id, rowId, user.workspaceId);

    await prisma.dataTableRow.delete({ where: { id: rowId } });
    await logActivity(user, {
      action: 'table.row.delete',
      summary: `apagou a linha ${describeRow(table.columns, row.data).title} da tabela ${quoted(table.name)}`,
      entityType: 'table',
      entityId: id,
      details: { rowId },
    });
    return ok({ ok: true });
  });
}
