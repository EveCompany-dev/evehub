import { dataColumnSchema, prisma, slugifyColumnKey, type DataColumn } from '@eve/core';
import { strings } from '@eve/ui';
import { z } from 'zod';
import { fail, handle, ok } from '../../../../lib/api';
import { HttpError, requireUser } from '../../../../lib/session';

export const runtime = 'nodejs';

// `key` is optional on input: the client never generates one (that logic —
// slugifyColumnKey — is server-only, so the browser bundle doesn't need to
// import anything from @eve/core). A missing key means "this is a new
// column"; an existing column's key is echoed back unchanged.
const columnInputSchema = dataColumnSchema.partial({ key: true });

const patchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  columns: z.array(columnInputSchema).min(1).optional(),
  webhookKeyColumn: z.string().min(1).max(60).nullable().optional(),
});

async function requireTable(id: string, workspaceId: string) {
  const table = await prisma.dataTable.findUnique({ where: { id } });
  if (!table || table.workspaceId !== workspaceId) throw new HttpError(404, strings.errors.notFound);
  return table;
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await context.params;
    const table = await requireTable(id, user.workspaceId);
    return ok({ table });
  });
}

/** Renames the table and/or replaces its column set (add/remove/relabel — never a key rename). */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await context.params;
    const existing = await requireTable(id, user.workspaceId);

    const body = patchSchema.safeParse(await request.json());
    if (!body.success) return fail(400, body.error.issues.map((issue) => issue.message).join('; '));

    let columns: DataColumn[] | undefined;
    if (body.data.columns) {
      const usedKeys: string[] = [];
      columns = body.data.columns.map((column) => {
        const key = column.key ?? slugifyColumnKey(column.label, usedKeys);
        usedKeys.push(key);
        return {
          key,
          label: column.label,
          type: column.type,
          ...(column.options ? { options: column.options } : {}),
          ...(column.optionColors ? { optionColors: column.optionColors } : {}),
        };
      });

      if (new Set(usedKeys).size !== usedKeys.length) return fail(400, 'Duas colunas não podem ter a mesma chave.');
    }

    if (body.data.webhookKeyColumn) {
      const availableKeys = (columns ?? (existing.columns as unknown as DataColumn[])).map((column) => column.key);
      if (!availableKeys.includes(body.data.webhookKeyColumn)) {
        return fail(400, `A coluna "${body.data.webhookKeyColumn}" não existe nesta tabela.`);
      }
    }

    const table = await prisma.dataTable.update({
      where: { id },
      data: {
        ...(body.data.name ? { name: body.data.name } : {}),
        ...(columns ? { columns } : {}),
        ...(body.data.webhookKeyColumn !== undefined ? { webhookKeyColumn: body.data.webhookKeyColumn } : {}),
      },
    });

    return ok({ table });
  });
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await context.params;
    await requireTable(id, user.workspaceId);

    await prisma.dataTable.delete({ where: { id } });
    return ok({ ok: true });
  });
}
