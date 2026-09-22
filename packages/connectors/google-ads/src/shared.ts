/**
 * Everything about the Google Ads connector that is pure data: no fetch, no
 * credentials. The widget bundle and the tests both import from here.
 */

/**
 * Pinned API version. Google retires a version roughly a year after release,
 * and the error mapping in ads-client.ts says so out loud when it happens —
 * bumping this is a deliberate decision, never a side effect.
 */
export const GOOGLE_ADS_API_VERSION = 'v21';

export const GOOGLE_ADS_BASE_URL = `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}`;

/** The relative ranges GAQL understands, in the order the config lists them. */
export const DATE_RANGES = ['TODAY', 'YESTERDAY', 'LAST_7_DAYS', 'LAST_14_DAYS', 'LAST_30_DAYS', 'THIS_MONTH', 'LAST_MONTH'] as const;

export type GoogleAdsDateRange = (typeof DATE_RANGES)[number];

export const DATE_RANGE_LABELS: Record<GoogleAdsDateRange, string> = {
  TODAY: 'Hoje',
  YESTERDAY: 'Ontem',
  LAST_7_DAYS: 'Últimos 7 dias',
  LAST_14_DAYS: 'Últimos 14 dias',
  LAST_30_DAYS: 'Últimos 30 dias',
  THIS_MONTH: 'Este mês',
  LAST_MONTH: 'Mês passado',
};

const CAMPAIGN_STATUS_LABELS: Record<string, string> = {
  ENABLED: 'Ativa',
  PAUSED: 'Pausada',
  REMOVED: 'Removida',
  UNKNOWN: 'Desconhecida',
  UNSPECIFIED: 'Desconhecida',
};

export const CAMPAIGN_STATUSES = ['Ativa', 'Pausada', 'Removida', 'Desconhecida'];

const CHANNEL_LABELS: Record<string, string> = {
  SEARCH: 'Rede de Pesquisa',
  DISPLAY: 'Display',
  SHOPPING: 'Shopping',
  VIDEO: 'Vídeo (YouTube)',
  MULTI_CHANNEL: 'Performance Max',
  PERFORMANCE_MAX: 'Performance Max',
  LOCAL: 'Local',
  SMART: 'Smart',
  DISCOVERY: 'Demand Gen',
  DEMAND_GEN: 'Demand Gen',
  TRAVEL: 'Viagens',
};

/** One campaign after the API row has been flattened and unit-converted. */
export interface CampaignSummary {
  id: string;
  name: string;
  status: string;
  channel: string;
  impressions: number;
  clicks: number;
  /** Already converted out of micros, in the account's own currency. */
  cost: number;
  conversions: number;
  /** Percentage points, e.g. 3.42 for a 3.42% click-through rate. */
  ctr: number;
  averageCpc: number;
}

/** What `sync()` stores verbatim as the snapshot. */
export interface GoogleAdsSnapshot {
  accountName: string;
  currencyCode: string;
  dateRange: GoogleAdsDateRange;
  campaigns: CampaignSummary[];
  totals: {
    impressions: number;
    clicks: number;
    cost: number;
    conversions: number;
  };
}

/** Shape of a `campaign` row as the REST API returns it (int64s arrive as strings). */
export interface CampaignRow {
  campaign?: {
    id?: string | number;
    name?: string;
    status?: string;
    advertisingChannelType?: string;
  };
  metrics?: {
    impressions?: string | number;
    clicks?: string | number;
    costMicros?: string | number;
    conversions?: string | number;
    ctr?: string | number;
    averageCpc?: string | number;
  };
}

export interface CustomerRow {
  customer?: {
    descriptiveName?: string;
    currencyCode?: string;
  };
}

/**
 * Customer ids are written with dashes everywhere in the Google UI
 * (123-456-7890) but the API only accepts the digits.
 */
export function digitsOnly(value: string): string {
  return value.replace(/\D/g, '');
}

/** int64s arrive as strings, doubles as numbers, and missing metrics as undefined. */
export function toNumber(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

/** Money comes in millionths of the account currency. Two decimals is what money has. */
export function microsToUnits(micros: unknown): number {
  return Math.round((toNumber(micros) / 1_000_000) * 100) / 100;
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export function statusLabel(status: string | undefined): string {
  if (!status) return 'Desconhecida';
  return CAMPAIGN_STATUS_LABELS[status] ?? status;
}

export function channelLabel(channel: string | undefined): string {
  if (!channel) return '—';
  return CHANNEL_LABELS[channel] ?? channel;
}

/**
 * Campaign performance for one relative range.
 *
 * REMOVED campaigns are left out: they cannot be acted on and they would pad
 * the widget with rows nobody reads. `segments.date` is what makes the metrics
 * cover the range instead of all time.
 */
export function campaignQuery(dateRange: GoogleAdsDateRange, limit: number): string {
  return [
    'SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type,',
    'metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.ctr, metrics.average_cpc',
    'FROM campaign',
    `WHERE segments.date DURING ${dateRange} AND campaign.status != 'REMOVED'`,
    'ORDER BY metrics.cost_micros DESC',
    `LIMIT ${limit}`,
  ].join(' ');
}

export const CUSTOMER_QUERY = 'SELECT customer.descriptive_name, customer.currency_code FROM customer LIMIT 1';

/** A row without a campaign id is not a campaign, so it is dropped rather than guessed at. */
export function toCampaignSummary(row: CampaignRow): CampaignSummary | null {
  const id = row.campaign?.id;
  if (id === undefined || id === null || String(id) === '') return null;

  const metrics = row.metrics ?? {};
  return {
    id: String(id),
    name: row.campaign?.name ?? `Campanha ${String(id)}`,
    status: statusLabel(row.campaign?.status),
    channel: channelLabel(row.campaign?.advertisingChannelType),
    impressions: toNumber(metrics.impressions),
    clicks: toNumber(metrics.clicks),
    cost: microsToUnits(metrics.costMicros),
    conversions: round(toNumber(metrics.conversions), 2),
    // The API reports a ratio; the column header says %.
    ctr: round(toNumber(metrics.ctr) * 100, 2),
    averageCpc: microsToUnits(metrics.averageCpc),
  };
}

export function sumTotals(campaigns: CampaignSummary[]): GoogleAdsSnapshot['totals'] {
  return campaigns.reduce(
    (totals, campaign) => ({
      impressions: totals.impressions + campaign.impressions,
      clicks: totals.clicks + campaign.clicks,
      cost: round(totals.cost + campaign.cost, 2),
      conversions: round(totals.conversions + campaign.conversions, 2),
    }),
    { impressions: 0, clicks: 0, cost: 0, conversions: 0 },
  );
}

/**
 * Read-only connectors still need a per-record version so a snapshot can tell
 * which rows actually moved. The numbers themselves are that version: same
 * metrics, same version, no churn in the edit log.
 */
export function campaignVersion(campaign: CampaignSummary): string {
  return [campaign.status, campaign.impressions, campaign.clicks, campaign.cost, campaign.conversions].join(':');
}
