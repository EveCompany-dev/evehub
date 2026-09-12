import { dataColumnSchema, Prisma, prisma } from '@eve/core';
import { strings } from '@eve/ui';
import { z } from 'zod';
import { fail, handle, ok } from '../../../../../lib/api';
import { HttpError, requireUser } from '../../../../../lib/session';

export const runtime = 'nodejs';

const createSchema = z.object({ data: z.record(z.string(), z.unknown()).default({}) });

async function requireTable(id: string, workspaceId: string) {
  const table = await prisma.dataTable.findUnique({ where: { id } });
  if (!table || table.workspaceId !== workspaceId) throw new HttpError(404, strings.errors.notFound);
  return table;
}

function validKeys(columnsJson: unknown): Set<string> {
  const columns = z.array(dataColumnSchema).catch([]).parse(columnsJson);
  return new Set(columns.map((column) => column.key));
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await context.params;
    await requireTable(id, user.workspaceId);

    const rows = await prisma.dataTableRow.findMany({ where: { tableId: id }, orderBy: { createdAt: 'asc' } });
    return ok({ rows });
  });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await context.params;
    const table = await requireTable(id, user.workspaceId);

    const body = createSchema.safeParse(await request.json());
    if (!body.success) return fail(400, strings.errors.invalidPayload);

    const keys = validKeys(table.columns);
    for (const key of Object.keys(body.data.data)) {
      if (!keys.has(key)) return fail(400, `A coluna "${key}" nao existe nesta tabela.`);
    }

    const row = await prisma.dataTableRow.create({
      data: { tableId: id, data: body.data.data as Prisma.InputJsonValue },
    });
    return ok({ row }, 201);
  });
}
