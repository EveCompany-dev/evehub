/**
 * Client-safe mirror of @eve/core's DataColumn shape. Defined separately
 * (rather than imported from @eve/core) so this file never pulls that
 * package's server-only runtime (Prisma, argon2, ioredis) into the browser
 * bundle — the same reasoning behind every connector's own shared.ts.
 */
export type DataColumnType = 'text' | 'number' | 'boolean' | 'date' | 'select' | 'multiselect' | 'url' | 'client';

export interface DataColumn {
  key: string;
  label: string;
  type: DataColumnType;
  options?: string[];
  /** Option -> palette key (see lib/table-tags). Options without an entry get a derived color. */
  optionColors?: Record<string, string>;
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

/** What a client relation cell needs to draw itself (the registry's brand fields). */
export interface TableClient {
  id: string;
  label: string;
  color: string | null;
  icon: string | null;
  logoUrl: string | null;
}

/** Everything a cell, the row page, the gallery and the calendar need to read and change one table. */
export interface TableEnv {
  table: DataTableSummary;
  clients: TableClient[];
  clientById: Record<string, TableClient>;
  saveCell: (rowId: string, key: string, value: unknown) => Promise<void>;
  /** Adds a tag/status option (with a meaningful color) to a select/multiselect column. */
  addOption: (columnKey: string, name: string) => Promise<void>;
  /** Registers a new client (Clientes) and returns it, or null on failure. */
  createClient: (name: string) => Promise<TableClient | null>;
}
