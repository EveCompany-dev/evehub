import type { EveConnector, FieldSchema, FieldType, RemoteRecord, SyncResult, WritePatch, WriteResult } from '@eve/connector-sdk';
import { registerConnector } from '@eve/connector-sdk';
import { z } from 'zod';
import { notionRequest, resolveDataSource, NotionError } from './notion-client';
import { buildPropertyPayload, readPageProperties, type NotionPropertyValue } from './properties';
import { isWritableType, normalizeDatabaseId, type NotionPropertySchema, type NotionSnapshot } from './shared';

/** Teto de seguranca: uma database enorme nao pode travar o worker. */
const MAX_PAGES = 5;
const PAGE_SIZE = 100;

const configSchema = z.object({
  databaseId: z
    .string()
    .min(1, 'Informe a URL ou o ID da database do Notion.')
    .transform((value, ctx) => {
      const normalized = normalizeDatabaseId(value);
      if (!normalized) {
        ctx.addIssue({ code: 'custom', message: 'Não consegui achar um ID de database nessa URL.' });
        return z.NEVER;
      }
      return normalized;
    }),
  /** Vazio = mostra todas as colunas. */
  visibleProperties: z.array(z.string()).default([]),
});

const credentialsSchema = z.object({
  token: z.string().min(10, 'O token da integração do Notion parece curto demais.'),
});

export type NotionConfig = z.infer<typeof configSchema>;
export type NotionCredentials = z.infer<typeof credentialsSchema>;

interface NotionPage {
  id: string;
  last_edited_time: string;
  url?: string;
  properties: Record<string, NotionPropertyValue>;
}

interface QueryResponse {
  results: NotionPage[];
  has_more?: boolean;
  next_cursor?: string | null;
}

interface DataSourceResponse {
  properties?: Record<string, { type: string; select?: { options?: { name: string }[] }; status?: { options?: { name: string }[] } }>;
}

/** Maps Notion's property types down to the SDK's generic field types. */
function toFieldType(notionType: string): FieldType {
  if (notionType === 'number') return 'number';
  if (notionType === 'checkbox') return 'boolean';
  if (notionType === 'date' || notionType === 'created_time' || notionType === 'last_edited_time') return 'date';
  if (notionType === 'select' || notionType === 'status') return 'select';
  return 'text';
}

function toRecord(page: NotionPage): RemoteRecord {
  return {
    remoteId: page.id,
    // O relogio da trava otimista. Ver a nota de granularidade no README.
    remoteVersion: page.last_edited_time,
    data: { ...readPageProperties(page.properties), _url: page.url ?? '' },
  };
}

async function fetchSchema(token: string, dataSourceId: string): Promise<NotionPropertySchema[]> {
  const dataSource = await notionRequest<DataSourceResponse>(token, `/data_sources/${dataSourceId}`);

  return Object.entries(dataSource.properties ?? {}).map(([name, property]) => {
    const options = property.select?.options ?? property.status?.options;
    return {
      name,
      type: property.type,
      writable: isWritableType(property.type),
      ...(options ? { options: options.map((option) => option.name) } : {}),
    } satisfies NotionPropertySchema;
  });
}

export const notionConnector: EveConnector<NotionConfig, NotionCredentials> = registerConnector<
  NotionConfig,
  NotionCredentials
>({
  id: 'notion',
  label: 'Notion',
  description: 'Lê e escreve uma database do Notion, com trava de conflito e desfazer de 10 minutos.',
  category: 'external',
  auth: 'token',
  capabilities: { read: true, write: true, webhook: false },
  // O Notion permite ~3 req/s em media; ficamos abaixo disso de proposito.
  rateLimit: { max: 150, windowMs: 60_000 },
  defaultSize: { w: 8, h: 9, minW: 4, minH: 5 },
  configSchema,
  credentialsSchema,
  defaultConfig: { databaseId: '', visibleProperties: [] },

  describeFields(snapshotData: unknown): FieldSchema[] {
    const snapshot = snapshotData as NotionSnapshot | null;
    if (!snapshot || !Array.isArray(snapshot.properties)) return [];

    // Title first: it's the name of the row for anyone reading the table, and
    // this is the order a fresh widget (no viewConfig saved yet) renders in.
    return snapshot.properties
      .slice()
      .sort((a, b) => (a.type === 'title' ? -1 : b.type === 'title' ? 1 : 0))
      .map((property) => ({
        key: property.name,
        label: property.name,
        type: toFieldType(property.type),
        writable: property.writable,
        ...(property.options ? { options: property.options } : {}),
      }));
  },

  async sync(ctx): Promise<SyncResult> {
    try {
      const { token } = ctx.credentials;
      const { dataSourceId, title } = await resolveDataSource(token, ctx.config.databaseId);

      const properties = await fetchSchema(token, dataSourceId);

      const records: RemoteRecord[] = [];
      let cursor: string | undefined;
      let truncated = false;

      for (let page = 0; page < MAX_PAGES; page += 1) {
        const response = await notionRequest<QueryResponse>(token, `/data_sources/${dataSourceId}/query`, {
          method: 'POST',
          body: { page_size: PAGE_SIZE, ...(cursor ? { start_cursor: cursor } : {}) },
        });

        records.push(...response.results.map(toRecord));

        if (!response.has_more || !response.next_cursor) break;
        cursor = response.next_cursor;
        if (page === MAX_PAGES - 1) truncated = true;
      }

      const snapshot: NotionSnapshot = {
        dataSourceId,
        databaseTitle: title,
        properties,
        rowCount: records.length,
        truncated,
        generatedAt: new Date().toISOString(),
      };

      return { ok: true, data: snapshot, records };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  },

  /**
   * Escrita com trava otimista.
   *
   * O Notion nao tem If-Match, entao a trava e feita a mao: le o
   * `last_edited_time` atual, compara com o que a tela tinha, e so entao aplica
   * o PATCH. Nao e atomico — existe uma janela de milissegundos entre a leitura
   * e a escrita — mas pega o caso real, que e alguem ter editado no Notion
   * enquanto a aba estava aberta.
   */
  async write(ctx, patch: WritePatch): Promise<WriteResult> {
    try {
      const { token } = ctx.credentials;
      const [field, value] = Object.entries(patch.patch)[0] ?? [];
      if (!field) return { ok: false, error: 'Nenhum campo para escrever.' };

      const current = await notionRequest<NotionPage>(token, `/pages/${patch.remoteId}`);

      if (current.last_edited_time !== patch.expectedVersion) {
        return {
          ok: false,
          conflict: true,
          currentVersion: current.last_edited_time,
          currentData: { ...readPageProperties(current.properties), _url: current.url ?? '' },
        };
      }

      const type = current.properties[field]?.type;
      if (!type) return { ok: false, error: `A propriedade "${field}" não existe nessa database.` };

      const updated = await notionRequest<NotionPage>(token, `/pages/${patch.remoteId}`, {
        method: 'PATCH',
        body: { properties: { [field]: buildPropertyPayload(field, type, value) } },
      });

      return {
        ok: true,
        newVersion: updated.last_edited_time,
        data: { ...readPageProperties(updated.properties), _url: updated.url ?? '' },
      };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  },

  async readVersion(ctx, remoteId): Promise<string | null> {
    try {
      const page = await notionRequest<NotionPage>(ctx.credentials.token, `/pages/${remoteId}`);
      return page.last_edited_time;
    } catch (error) {
      // Pagina apagada ou fora do alcance da integracao: sem versao para desfazer.
      if (error instanceof NotionError && (error.status === 404 || error.code === 'object_not_found')) return null;
      throw error;
    }
  },
});
