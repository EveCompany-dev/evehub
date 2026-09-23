import type { EveConnector, FieldSchema, RemoteRecord, SyncResult } from '@eve/connector-sdk';
import { registerConnector } from '@eve/connector-sdk';
import { z } from 'zod';
import { adsSearch } from './ads-client';
import {
  CAMPAIGN_STATUSES,
  CUSTOMER_QUERY,
  DATE_RANGES,
  campaignQuery,
  campaignVersion,
  digitsOnly,
  sumTotals,
  toCampaignSummary,
  type CampaignRow,
  type CampaignSummary,
  type CustomerRow,
  type GoogleAdsSnapshot,
} from './shared';

/** Safety ceiling: a manager account with hundreds of campaigns can't stall the worker. */
const MAX_PAGES = 3;
const PAGE_SIZE = 200;

const customerId = z
  .string()
  .min(1, 'Informe o ID da conta do Google Ads.')
  .transform((value, ctx) => {
    const digits = digitsOnly(value);
    if (digits.length < 8) {
      ctx.addIssue({ code: 'custom', message: 'O ID da conta tem 10 dígitos, como 123-456-7890.' });
      return z.NEVER;
    }
    return digits;
  });

const configSchema = z.object({
  customerId,
  /** Only needed when the account is reached through a manager (MCC) account. */
  loginCustomerId: z
    .string()
    .optional()
    .transform((value) => (value ? digitsOnly(value) : undefined)),
  dateRange: z.enum(DATE_RANGES).default('LAST_30_DAYS'),
});

const credentialsSchema = z.object({
  clientId: z.string().min(10, 'O client ID do OAuth parece curto demais.'),
  clientSecret: z.string().min(5, 'O client secret do OAuth parece curto demais.'),
  refreshToken: z.string().min(10, 'O refresh token parece curto demais.'),
  developerToken: z.string().min(5, 'O developer token parece curto demais.'),
});

export type GoogleAdsConfig = z.infer<typeof configSchema>;
export type GoogleAdsCredentials = z.infer<typeof credentialsSchema>;

function toRecord(campaign: CampaignSummary): RemoteRecord {
  return {
    remoteId: campaign.id,
    remoteVersion: campaignVersion(campaign),
    data: {
      campanha: campaign.name,
      status: campaign.status,
      canal: campaign.channel,
      impressoes: campaign.impressions,
      cliques: campaign.clicks,
      custo: campaign.cost,
      conversoes: campaign.conversions,
      ctr: campaign.ctr,
      cpcMedio: campaign.averageCpc,
    },
  };
}

/**
 * Read-only view of one Google Ads account's campaign performance.
 *
 * Read-only on purpose, and the same call the planning doc makes: changing a
 * live campaign from a dashboard is a far riskier operation than reading one,
 * so `write()` stays absent until somebody asks for it deliberately.
 *
 * Renders through the generic config-driven widget (see the web app's widget
 * registry) — `describeFields()` is what gives it its columns.
 */
export const googleAdsConnector: EveConnector<GoogleAdsConfig, GoogleAdsCredentials> = registerConnector<
  GoogleAdsConfig,
  GoogleAdsCredentials
>({
  id: 'google-ads',
  label: 'Google Ads (anúncios)',
  // Ads only, on purpose: posting to Google (Perfil da Empresa / Business) will be a connector of its own.
  description: 'Só os anúncios: desempenho das campanhas (impressões, cliques, custo, conversões) da conta do Google Ads do cliente. Somente leitura — não publica nada no Google.',
  category: 'external',
  auth: 'oauth2',
  capabilities: { read: true, write: false, webhook: false },
  // Well under the basic access tier's daily operation budget.
  rateLimit: { max: 60, windowMs: 60_000 },
  defaultSize: { w: 8, h: 8, minW: 4, minH: 5 },
  configSchema,
  credentialsSchema,
  defaultConfig: { customerId: '', loginCustomerId: undefined, dateRange: 'LAST_30_DAYS' },

  describeFields(snapshotData: unknown): FieldSchema[] {
    const snapshot = snapshotData as GoogleAdsSnapshot | null;
    // Money columns carry the account's own currency, so a BRL account never
    // reads as dollars.
    const currency = snapshot?.currencyCode ? ` (${snapshot.currencyCode})` : '';

    return [
      { key: 'campanha', label: 'Campanha', type: 'text', writable: false },
      { key: 'status', label: 'Status', type: 'select', writable: false, options: CAMPAIGN_STATUSES },
      { key: 'canal', label: 'Canal', type: 'text', writable: false },
      { key: 'impressoes', label: 'Impressões', type: 'number', writable: false },
      { key: 'cliques', label: 'Cliques', type: 'number', writable: false },
      { key: 'custo', label: `Custo${currency}`, type: 'number', writable: false },
      { key: 'conversoes', label: 'Conversões', type: 'number', writable: false },
      { key: 'ctr', label: 'CTR (%)', type: 'number', writable: false },
      { key: 'cpcMedio', label: `CPC médio${currency}`, type: 'number', writable: false },
    ];
  },

  async sync(ctx): Promise<SyncResult> {
    const auth = ctx.credentials;
    const target = { customerId: ctx.config.customerId, loginCustomerId: ctx.config.loginCustomerId };

    try {
      const account = await adsSearch<CustomerRow>(auth, { ...target, query: CUSTOMER_QUERY });
      const customer = account.results?.[0]?.customer;

      const campaigns: CampaignSummary[] = [];
      let pageToken: string | undefined;

      for (let page = 0; page < MAX_PAGES; page++) {
        const response = await adsSearch<CampaignRow>(auth, {
          ...target,
          query: campaignQuery(ctx.config.dateRange, PAGE_SIZE),
          pageSize: PAGE_SIZE,
          ...(pageToken ? { pageToken } : {}),
        });

        for (const row of response.results ?? []) {
          const summary = toCampaignSummary(row);
          if (summary) campaigns.push(summary);
        }

        pageToken = response.nextPageToken;
        if (!pageToken) break;
      }

      const snapshot: GoogleAdsSnapshot = {
        accountName: customer?.descriptiveName ?? ctx.config.customerId,
        currencyCode: customer?.currencyCode ?? '',
        dateRange: ctx.config.dateRange,
        campaigns,
        totals: sumTotals(campaigns),
      };

      return { ok: true, data: snapshot, records: campaigns.map(toRecord) };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  },
});
