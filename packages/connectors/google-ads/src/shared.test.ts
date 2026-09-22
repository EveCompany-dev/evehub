import { describe, expect, it } from 'vitest';
import {
  campaignQuery,
  campaignVersion,
  channelLabel,
  digitsOnly,
  microsToUnits,
  statusLabel,
  sumTotals,
  toCampaignSummary,
  type CampaignRow,
} from './shared';

describe('ids and money', () => {
  it('strips the dashes Google shows in its own UI', () => {
    expect(digitsOnly('123-456-7890')).toBe('1234567890');
    expect(digitsOnly('1234567890')).toBe('1234567890');
  });

  it('converts micros to the account currency, to the cent', () => {
    expect(microsToUnits('56000000')).toBe(56);
    expect(microsToUnits(1_234_567)).toBe(1.23);
    expect(microsToUnits(undefined)).toBe(0);
    expect(microsToUnits('não é número')).toBe(0);
  });
});

describe('toCampaignSummary', () => {
  const row: CampaignRow = {
    campaign: { id: '987', name: 'Institucional — Search', status: 'ENABLED', advertisingChannelType: 'SEARCH' },
    metrics: { impressions: '15230', clicks: '412', costMicros: '870450000', conversions: 12.5, ctr: 0.027, averageCpc: '2112742' },
  };

  it('flattens an API row, translating units and labels', () => {
    expect(toCampaignSummary(row)).toEqual({
      id: '987',
      name: 'Institucional — Search',
      status: 'Ativa',
      channel: 'Rede de Pesquisa',
      impressions: 15230,
      clicks: 412,
      cost: 870.45,
      conversions: 12.5,
      // The API reports a ratio; the column says %.
      ctr: 2.7,
      averageCpc: 2.11,
    });
  });

  it('treats missing metrics as zero instead of NaN', () => {
    const summary = toCampaignSummary({ campaign: { id: '1', name: 'Nova', status: 'PAUSED' } })!;
    expect(summary).toMatchObject({ status: 'Pausada', impressions: 0, clicks: 0, cost: 0, conversions: 0, ctr: 0 });
    expect(summary.channel).toBe('—');
  });

  it('drops a row that carries no campaign id', () => {
    expect(toCampaignSummary({ metrics: { clicks: '3' } })).toBeNull();
    expect(toCampaignSummary({ campaign: { name: 'sem id' } })).toBeNull();
  });

  it('keeps unknown statuses and channels readable rather than blank', () => {
    expect(statusLabel('SOMETHING_NEW')).toBe('SOMETHING_NEW');
    expect(statusLabel(undefined)).toBe('Desconhecida');
    expect(channelLabel('PERFORMANCE_MAX')).toBe('Performance Max');
  });
});

describe('campaignQuery', () => {
  it('asks for the chosen range and leaves removed campaigns out', () => {
    const query = campaignQuery('LAST_7_DAYS', 200);
    expect(query).toContain('segments.date DURING LAST_7_DAYS');
    expect(query).toContain("campaign.status != 'REMOVED'");
    expect(query).toContain('LIMIT 200');
    expect(query).toContain('metrics.cost_micros');
  });
});

describe('totals and versions', () => {
  const campaigns = [
    toCampaignSummary({ campaign: { id: '1', name: 'A', status: 'ENABLED' }, metrics: { impressions: '10', clicks: '2', costMicros: '1500000', conversions: 1 } })!,
    toCampaignSummary({ campaign: { id: '2', name: 'B', status: 'PAUSED' }, metrics: { impressions: '5', clicks: '1', costMicros: '2250000', conversions: 0.5 } })!,
  ];

  it('adds the account up without floating-point dust', () => {
    expect(sumTotals(campaigns)).toEqual({ impressions: 15, clicks: 3, cost: 3.75, conversions: 1.5 });
    expect(sumTotals([])).toEqual({ impressions: 0, clicks: 0, cost: 0, conversions: 0 });
  });

  it('gives a record the same version while its numbers stand still', () => {
    expect(campaignVersion(campaigns[0]!)).toBe(campaignVersion({ ...campaigns[0]! , name: 'renomeada' }));
    expect(campaignVersion(campaigns[0]!)).not.toBe(campaignVersion({ ...campaigns[0]!, clicks: 3 }));
  });
});
