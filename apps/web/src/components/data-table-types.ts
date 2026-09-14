/**
 * Client-safe mirror of @eve/core's DataColumn shape. Defined separately
 * (rather than imported from @eve/core) so this file never pulls that
 * package's server-only runtime (Prisma, argon2, ioredis) into the browser
 * bundle — the same reasoning behind every connector's own shared.ts.
 */
export type DataColumnType = 'text' | 'number' | 'boolean' | 'date' | 'select' | 'client';

export interface DataColumn {
  key: string;
  label: string;
  type: DataColumnType;
  options?: string[];
}

export interface DataTableSummary {
  id: string;
  name: string;
  columns: DataColumn[];
  webhookToken: string | null;
  webhookKeyColumn: string | null;
}

export interface DataTableRowValue {
  id: string;
  tableId: string;
  data: Record<string, unknown>;
}
