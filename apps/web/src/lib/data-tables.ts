import { prisma } from '@eve/core';
import { strings } from '@eve/ui';
import { HttpError } from './session';

/** Loads a data table, 404 unless it belongs to the caller's workspace. */
export async function requireTable(id: string, workspaceId: string) {
  const table = await prisma.dataTable.findUnique({ where: { id } });
  if (!table || table.workspaceId !== workspaceId) throw new HttpError(404, strings.errors.notFound);
  return table;
}
