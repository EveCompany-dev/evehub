import { coerceColumnValue, dataColumnTypeSchema, prisma, slugifyColumnKey, type DataColumn, type Prisma } from '@eve/core';
import { strings } from '@eve/ui';
import { z } from 'zod';
import { logActivity, quoted } from '../../../../lib/activity';
import { fail, handle, ok } from '../../../../lib/api';
import { canViewScheduling } from '../../../../lib/permissions';
import { HttpError, requireUser } from '../../../../lib/session';
import { normalizeName } from '../../../../lib/table-import/clients';

export const runtime = 'nodejs';

const MAX_ROWS = 10_000;
const NEW_CLIENT_PREFIX = 'new:';

const bodySchema = z.object({
  name: z.string().trim().min(1).max(120),
  columns: z
    .array(
      z.object({
        label: z.string().trim().min(1).max(120),
        type: dataColumnTypeSchema,
        options: z.array(z.string()).max(500).optional(),
        optionColors: z.record(z.string(), z.string().max(20)).optional(),
      }),
    )
    .min(1)
    .max(100),
  /** One array per row, aligned with `columns`. */
  rows: z.array(z.array(z.unknown())).max(MAX_ROWS),
  /** Names of clients to create; rows reference them as "new:<name>". */
  newClients: z.array(z.string().trim().min(1).max(120)).max(1000).default([]),
});

/**
 * Creates a whole table — columns, tag options and every row — in one
 * transaction, so a failed import leaves nothing half-built behind. Import
 * always makes a *new* table (never merges into an existing one).
 *
 * Client cells arrive as an existing client id or "new:<name>"; new names are
 * created here (skipping any that already exist by name, so importing twice
 * doesn't duplicate the registry). Creating clients needs the same permission
 * as the Clientes tab itself.
 */
export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();

    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return fail(400, `Importação inválida: ${parsed.error.issues.map((issue) => issue.message).join('; ')}`);
    }
    const body = parsed.data;

    const width = body.columns.length;
    const tooWide = body.rows.findIndex((row) => row.length > width);
    if (tooWide >= 0) return fail(400, `A linha ${tooWide + 1} tem mais células do que colunas.`);

    const existingClients = await prisma.client.findMany({
      where: { workspaceId: user.workspaceId },
      select: { id: true, name: true },
    });
    const clientIds = new Set(existingClients.map((client) => client.id));
    const idByName = new Map(existingClients.map((client) => [normalizeName(client.name), client.id]));

    const toCreate = [...new Map(body.newClients.map((name) => [normalizeName(name), name])).entries()].filter(([key]) => !idByName.has(key));
    if (toCreate.length > 0 && !canViewScheduling(user)) {
      throw new HttpError(403, `${strings.errors.notAllowedScheduling} (necessário para criar ${toCreate.length} cliente(s) novo(s)).`);
    }

    const usedKeys: string[] = [];
    const columns: DataColumn[] = body.columns.map((column) => {
      const key = slugifyColumnKey(column.label, usedKeys);
      usedKeys.push(key);
      return { key, label: column.label, type: column.type, ...(column.options ? { options: [...column.options] } : {}), ...(column.optionColors ? { optionColors: column.optionColors } : {}) };
    });

    const result = await prisma.$transaction(
      async (tx) => {
        for (const [key, name] of toCreate) {
          const created = await tx.client.create({ data: { workspaceId: user.workspaceId, name }, select: { id: true } });
          idByName.set(key, created.id);
          clientIds.add(created.id);
        }

        const resolveClient = (value: unknown): string | null => {
          if (typeof value !== 'string' || value === '') return null;
          if (value.startsWith(NEW_CLIENT_PREFIX)) return idByName.get(normalizeName(value.slice(NEW_CLIENT_PREFIX.length))) ?? null;
          return clientIds.has(value) ? value : null;
        };

        const rowData: Prisma.InputJsonValue[] = body.rows.map((cells) => {
          const data: Record<string, unknown> = {};
          columns.forEach((column, index) => {
            const raw = cells[index];
            if (raw === null || raw === undefined || raw === '') return;
            const value = column.type === 'client' ? resolveClient(raw) : coerceColumnValue(raw, column.type);
            if (value === null || (Array.isArray(value) && value.length === 0)) return;
            data[column.key] = value;
            // A value the plan didn't list as an option would render as an
            // orphan pill and be unfilterable — fold it into the options.
            if (column.type === 'select' || column.type === 'multiselect') {
              const options = (column.options ??= []);
              for (const tag of Array.isArray(value) ? (value as string[]) : [String(value)]) {
                if (!options.includes(tag)) options.push(tag);
              }
            }
          });
          return data as Prisma.InputJsonValue;
        });

        const table = await tx.dataTable.create({
          data: { workspaceId: user.workspaceId, name: body.name, columns: columns as unknown as Prisma.InputJsonValue },
          select: { id: true, name: true, columns: true, webhookToken: true, webhookKeyColumn: true },
        });
        if (rowData.length > 0) {
          // Rows are listed by createdAt, and one createMany stamps them all with the
          // same now() — give each its own millisecond so the CSV order survives.
          const base = Date.now();
          await tx.dataTableRow.createMany({
            data: rowData.map((data, index) => ({ tableId: table.id, data, createdAt: new Date(base + index) })),
          });
        }
        return { table, rowCount: rowData.length };
      },
      { timeout: 60_000, maxWait: 10_000 },
    );

    await logActivity(user, {
      action: 'table.import',
      summary: `importou a tabela ${quoted(result.table.name)} com ${result.rowCount} linha(s)${toCreate.length > 0 ? ` e cadastrou ${toCreate.length} cliente(s) novo(s)` : ''}`,
      entityType: 'table',
      entityId: result.table.id,
    });

    return ok({ ...result, createdClients: toCreate.length }, 201);
  });
}
