import { describe, expect, it } from 'vitest';
import { connectorAlertFor, connectorAlertMessage } from './connector-alerts';

describe('connectorAlertFor', () => {
  it('announces the break, once', () => {
    expect(connectorAlertFor('ok', false)).toBe('failed');
    // The token is still revoked five minutes later; that is not news.
    expect(connectorAlertFor('error', false)).toBeNull();
  });

  it('announces the recovery, once', () => {
    expect(connectorAlertFor('error', true)).toBe('recovered');
    expect(connectorAlertFor('ok', true)).toBeNull();
  });

  it('treats an interrupted run as "was not failing", so the next failure still counts', () => {
    expect(connectorAlertFor('syncing', false)).toBe('failed');
    expect(connectorAlertFor('syncing', true)).toBeNull();
  });
});

describe('connectorAlertMessage', () => {
  it('names the connector and what the upstream said', () => {
    expect(connectorAlertMessage('failed', 'Google Ads — Eve', 'O refresh token do Google foi revogado.')).toBe(
      'O conector “Google Ads — Eve” parou de sincronizar: O refresh token do Google foi revogado.',
    );
  });

  it('still reads properly when there is no detail to give', () => {
    expect(connectorAlertMessage('failed', 'Notion')).toBe('O conector “Notion” parou de sincronizar.');
    expect(connectorAlertMessage('recovered', 'Notion')).toBe('O conector “Notion” voltou a sincronizar.');
  });
});
