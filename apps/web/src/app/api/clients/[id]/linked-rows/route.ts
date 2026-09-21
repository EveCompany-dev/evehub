import { dataColumnSchema, prisma } from '@eve/core';
import { z } from 'zod';
import type { DataColumn, DataTableRowValue } from '../../../../../components/data-table-types';
import { handle, ok } from '../../../../../lib/api';
import { requireClient } from '../../../../../lib/jobs';
import { requireUser } from '../../../../../lib/session';
import { rowTitle } from '../../../../../lib/table-views';

export const runtime = 'nodejs';

const MAX_ROWS_PER_TABLE = 40;

/**
 * Every Tabelas row that points at this client through a client-relation
 * column — the back-link of the relation, so a client's page shows its
 * posts, ideas and schedule without anyone maintaining a second list.
 * Matching happens in application code (tables are small, locally managed
 * data — same reasoning as the webhook ingestion route).
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await context.params;
    await requireClient(id, user.workspaceId);

    const tables = await prisma.dataTable.findMany({ where: { workspaceId: user.workspaceId }, orderBy: { createdAt: 'asc' } });

    const groups = [];
    for (const table of tables) {
      const columns = z.array(dataColumnSchema).catch([]).parse(table.columns) as DataColumn[];
      const clientKeys = columns.filter((column) => column.type === 'client').map((column) => column.key);
      if (clientKeys.length === 0) continue;

      const rows = await prisma.dataTableRow.findMany({ where: { tableId: table.id }, orderBy: { createdAt: 'asc' } });
      const linked = rows.filter((row) => clientKeys.some((key) => (row.data as Record<string, unknown>)[key] === id));
      if (linked.length === 0) continue;

      const status = columns.find((column) => column.type === 'select') ?? columns.find((column) => column.type === 'multiselect');
      groups.push({
        table: { id: table.id, name: table.name },
        count: linked.length,
        rows: linked.slice(0, MAX_ROWS_PER_TABLE).map((row) => {
          const data = row.data as Record<string, unknown>;
          const tag = status ? data[status.key] : null;
          return {
            id: row.id,
            title: rowTitle(columns, { id: row.id, tableId: table.id, data } satisfies DataTableRowValue, {}),
            tags: (Array.isArray(tag) ? tag.map(String) : tag ? [String(tag)] : []).map((name) => ({
              name,
              color: status?.optionColors?.[name] ?? null,
            })),
          };
        }),
      });
    }

    return ok({ groups });
  });
}
