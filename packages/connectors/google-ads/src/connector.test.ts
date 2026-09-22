import type { ConnectorContext } from '@eve/connector-sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { adsSearch } from './ads-client';
import { googleAdsConnector, type GoogleAdsConfig, type GoogleAdsCredentials } from './connector';
import type { GoogleAdsSnapshot } from './shared';

// Only the HTTP layer is faked: the query building, unit conversion and
// record mapping under test are the connector's own.
vi.mock('./ads-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./ads-client')>()),
  adsSearch: vi.fn(),
}));

const mockedSearch = vi.mocked(adsSearch);

const credentials: GoogleAdsCredentials = {
  clientId: 'client-id-longo',
  clientSecret: 'client-secret',
  refreshToken: 'refresh-token-longo',
  developerToken: 'dev-token',
};

function context(config: Partial<GoogleAdsConfig> = {}): ConnectorContext<GoogleAdsConfig, GoogleAdsCredentials> {
  return {
    instanceId: 'instance-1',
    config: { customerId: '1234567890', loginCustomerId: undefined, dateRange: 'LAST_30_DAYS', ...config },
    credentials,
    lastSyncedAt: null,
  };
}

const account = { results: [{ customer: { descriptiveName: 'Eve Company', currencyCode: 'BRL' } }] };

const campaignPage = {
  results: [
    {
      campaign: { id: '11', name: 'Search — Marca', status: 'ENABLED', advertisingChannelType: 'SEARCH' },
      metrics: { impressions: '2000', clicks: '100', costMicros: '250000000', conversions: 8, ctr: 0.05, averageCpc: '2500000' },
    },
    {
      campaign: { id: '22', name: 'PMax — Catálogo', status: 'PAUSED', advertisingChannelType: 'PERFORMANCE_MAX' },
      metrics: { impressions: '1000', clicks: '40', costMicros: '125500000', conversions: 2.5, ctr: 0.04, averageCpc: '3137500' },
    },
  ],
};

beforeEach(() => {
  mockedSearch.mockReset();
});

describe('the connector contract', () => {
  it('is registered read-only, as an external integration', () => {
    expect(googleAdsConnector.id).toBe('google-ads');
    expect(googleAdsConnector.category).toBe('external');
    expect(googleAdsConnector.capabilities).toEqual({ read: true, write: false, webhook: false });
    // Read-only means no write path at all, not a write that refuses.
    expect(googleAdsConnector.write).toBeUndefined();
  });

  it('accepts the account id the way Google prints it, and refuses a stub', () => {
    const parsed = googleAdsConnector.configSchema.parse({ customerId: '123-456-7890', dateRange: 'LAST_7_DAYS' });
    expect(parsed).toMatchObject({ customerId: '1234567890', dateRange: 'LAST_7_DAYS' });
    expect(googleAdsConnector.configSchema.parse({ customerId: '1234567890' }).dateRange).toBe('LAST_30_DAYS');
    expect(() => googleAdsConnector.configSchema.parse({ customerId: '12' })).toThrow(/10 dígitos/);
  });

  it('names the money columns after the account currency', () => {
    const snapshot = { currencyCode: 'BRL', campaigns: [] } as unknown as GoogleAdsSnapshot;
    const labels = googleAdsConnector.describeFields!(snapshot).map((field) => field.label);
    expect(labels).toContain('Custo (BRL)');
    expect(labels).toContain('CPC médio (BRL)');
    // Nothing is editable from here.
    expect(googleAdsConnector.describeFields!(snapshot).every((field) => !field.writable)).toBe(true);
  });
});

describe('sync', () => {
  it('reports the account, its campaigns and the totals', async () => {
    mockedSearch.mockResolvedValueOnce(account as never).mockResolvedValueOnce(campaignPage as never);

    const result = await googleAdsConnector.sync(context());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const snapshot = result.data as GoogleAdsSnapshot;
    expect(snapshot.accountName).toBe('Eve Company');
    expect(snapshot.currencyCode).toBe('BRL');
    expect(snapshot.campaigns.map((campaign) => campaign.name)).toEqual(['Search — Marca', 'PMax — Catálogo']);
    expect(snapshot.totals).toEqual({ impressions: 3000, clicks: 140, cost: 375.5, conversions: 10.5 });

    expect(result.records).toHaveLength(2);
    expect(result.records![0]).toMatchObject({
      remoteId: '11',
      data: { campanha: 'Search — Marca', status: 'Ativa', canal: 'Rede de Pesquisa', custo: 250, ctr: 5, cpcMedio: 2.5 },
    });
    // Same numbers next time means the same version, so unchanged rows stay quiet.
    expect(result.records![0]!.remoteVersion).toBe('Ativa:2000:100:250:8');
  });

  it('asks for the range the instance is configured with', async () => {
    mockedSearch.mockResolvedValueOnce(account as never).mockResolvedValueOnce({ results: [] } as never);

    await googleAdsConnector.sync(context({ dateRange: 'THIS_MONTH', loginCustomerId: '9999999999' }));

    const [, options] = mockedSearch.mock.calls[1]!;
    expect(options.query).toContain('DURING THIS_MONTH');
    expect(options.customerId).toBe('1234567890');
    expect(options.loginCustomerId).toBe('9999999999');
  });

  it('follows the page token, and stops at the safety ceiling', async () => {
    mockedSearch.mockResolvedValueOnce(account as never);
    // Every page claims there is another one: the cap is what ends this.
    mockedSearch.mockResolvedValue({ results: campaignPage.results, nextPageToken: 'mais' } as never);

    const result = await googleAdsConnector.sync(context());
    expect(result.ok).toBe(true);
    // 1 account query + 3 campaign pages.
    expect(mockedSearch).toHaveBeenCalledTimes(4);
    if (result.ok) expect(result.records).toHaveLength(6);
  });

  it('hands the API message back instead of throwing at the worker', async () => {
    mockedSearch.mockRejectedValueOnce(new Error('O developer token ainda não foi aprovado para esta conta.'));

    const result = await googleAdsConnector.sync(context());
    expect(result).toEqual({ ok: false, error: 'O developer token ainda não foi aprovado para esta conta.' });
  });

  it('still syncs when the account query comes back empty', async () => {
    mockedSearch.mockResolvedValueOnce({ results: [] } as never).mockResolvedValueOnce(campaignPage as never);

    const result = await googleAdsConnector.sync(context());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const snapshot = result.data as GoogleAdsSnapshot;
    // Falls back to the id, and the money columns simply lose their suffix.
    expect(snapshot.accountName).toBe('1234567890');
    expect(googleAdsConnector.describeFields!(snapshot).find((field) => field.key === 'custo')!.label).toBe('Custo');
  });
});
