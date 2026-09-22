// Importing this package registers the connector as a side effect.
export { googleAdsConnector, type GoogleAdsConfig, type GoogleAdsCredentials } from './connector';
export { GoogleAdsError, adsSearch, describeError, getAccessToken, resetTokenCacheForTests } from './ads-client';
export {
  CAMPAIGN_STATUSES,
  DATE_RANGES,
  DATE_RANGE_LABELS,
  GOOGLE_ADS_API_VERSION,
  campaignQuery,
  campaignVersion,
  channelLabel,
  digitsOnly,
  microsToUnits,
  statusLabel,
  sumTotals,
  toCampaignSummary,
  type CampaignSummary,
  type GoogleAdsDateRange,
  type GoogleAdsSnapshot,
} from './shared';
