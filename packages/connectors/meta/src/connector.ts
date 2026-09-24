import type { EveConnector, FieldSchema, RemoteRecord, SyncResult } from '@eve/connector-sdk';
import { registerConnector } from '@eve/connector-sdk';
import { z } from 'zod';
import { graphRequest } from './graph-client';

/**
 * Graph ids are numeric, and these two are interpolated straight into the API
 * path (`/${pageId}/photos`). `min(1)` accepted `?`, `/` and `#`, which let a
 * value like `me/accounts?fields=access_token&x=` choose both the endpoint and
 * its parameters — the host is a fixed literal, so it was path and parameter
 * injection rather than SSRF, but the caller still decided which Graph call
 * the owner's token made. Notion's databaseId is the pattern being copied here.
 */
const graphId = z.string().regex(/^\d{1,25}$/, 'Use apenas o ID numerico, sem barras nem parametros.');

const configSchema = z.object({
  pageId: graphId,
  /** Necessario so para publicar no Instagram; a Pagina sozinha ja basta pro Facebook. */
  instagramBusinessAccountId: graphId.optional(),
});

const credentialsSchema = z.object({
  /** Token de acesso de longa duracao da Pagina — gerado no Graph API Explorer/Business Suite. */
  pageAccessToken: z.string().min(10, 'O token de acesso da Pagina parece curto demais.'),
});

export type MetaConfig = z.infer<typeof configSchema>;
export type MetaCredentials = z.infer<typeof credentialsSchema>;

interface PageResponse {
  name?: string;
  instagram_business_account?: { id: string };
}

const REMOTE_ID = 'page';

/**
 * Holds the Page/IG credentials the scheduling feature publishes through.
 *
 * `sync()` here is a real identity/health check (confirms the token still
 * works and reports the page name), not a data sync — there is no "table" to
 * mirror. The actual publish calls (packages/connectors/meta/src/publish.ts)
 * are called directly by the scheduling API routes and the worker's tick,
 * not through `write()` — creating/editing a scheduled post doesn't fit the
 * single-field optimistic-lock shape any better than a chat turn did.
 */
export const metaConnector: EveConnector<MetaConfig, MetaCredentials> = registerConnector<MetaConfig, MetaCredentials>({
  id: 'meta',
  label: 'Meta (Instagram/Facebook)',
  description: 'Conecta uma Página do Facebook (e a conta do Instagram vinculada) para a agenda de posts.',
  category: 'external',
  auth: 'token',
  capabilities: { read: true, write: false, webhook: false },
  defaultSize: { w: 4, h: 5, minW: 3, minH: 4 },
  configSchema,
  credentialsSchema,
  defaultConfig: { pageId: '', instagramBusinessAccountId: undefined },

  describeFields(): FieldSchema[] {
    return [
      { key: 'pageName', label: 'Pagina', type: 'text', writable: false },
      { key: 'instagramLinked', label: 'Instagram vinculado', type: 'boolean', writable: false },
    ];
  },

  async sync(ctx): Promise<SyncResult> {
    try {
      const page = await graphRequest<PageResponse>(ctx.credentials.pageAccessToken, `/${ctx.config.pageId}`, {
        params: { fields: 'name,instagram_business_account' },
      });

      const record: RemoteRecord = {
        remoteId: REMOTE_ID,
        remoteVersion: '1',
        data: { pageName: page.name ?? ctx.config.pageId, instagramLinked: Boolean(page.instagram_business_account) },
      };

      return { ok: true, data: null, records: [record] };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  },
});
