import { coerceColumnValue, dataColumnSchema, prisma, type Prisma } from '@eve/core';
import { strings } from '@eve/ui';
import { z } from 'zod';
import { fail, handle, ok } from '../../../../../lib/api';
import { HttpError } from '../../../../../lib/session';

export const runtime = 'nodejs';

/**
 * Public, unauthenticated ingestion endpoint — the token IS the credential.
 * Same 404 whether the token is wrong or was never generated, so a guesser
 * never learns whether a given token is close to valid.
 *
 * Row matching happens in application code rather than a Prisma JSON `path`
 * filter: tables here are small, locally-managed data, so a `findMany` +
 * in-memory match is simpler to reason about and sidesteps any JSON-type
 * mismatch edge cases between what's stored and what a sender posts.
 */
export async function POST(request: Request, context: { params: Promise<{ token: string }> }): Promise<Response> {
  return handle(async () => {
    const { token } = await context.params;

    const table = await prisma.dataTable.findUnique({ where: { webhookToken: token } });
    if (!table) throw new HttpError(404, strings.errors.notFound);

    const payload = await request.json().catch(() => null);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return fail(400, 'Corpo invalido: esperado um objeto JSON.');
    }

    const columns = z.array(dataColumnSchema).catch([]).parse(table.columns);
    const columnByKey = new Map(columns.map((column) => [column.key, column]));

    const mapped: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
      const column = columnByKey.get(key);
      if (!column) continue; // unknown keys are silently dropped, not rejected
      mapped[key] = coerceColumnValue(value, column.type);
    }

    const keyColumn = table.webhookKeyColumn;
    if (keyColumn && keyColumn in mapped) {
      const candidates = await prisma.dataTableRow.findMany({ where: { tableId: table.id } });
      const match = candidates.find((candidate) => (candidate.data as Record<string, unknown>)[keyColumn] === mapped[keyColumn]);

      if (match) {
        const row = await prisma.dataTableRow.update({
          where: { id: match.id },
          data: { data: { ...(match.data as Record<string, unknown>), ...mapped } as Prisma.InputJsonValue },
        });
        return ok({ ok: true, created: false, row });
      }
    }

    const row = await prisma.dataTableRow.create({
      data: { tableId: table.id, data: mapped as Prisma.InputJsonValue },
    });
    return ok({ ok: true, created: true, row }, 201);
  });
}
