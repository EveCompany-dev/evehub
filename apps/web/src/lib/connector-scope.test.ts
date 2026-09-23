import { describe, expect, it } from 'vitest';
import { isClientConnector, isTeamConnector } from './connector-scope';

const external = (id: string) => ({ id, category: 'external' });

describe('connector scope', () => {
  it('gives a client its social media and its Google Ads', () => {
    expect(isClientConnector({ id: 'meta' })).toBe(true);
    expect(isClientConnector({ id: 'google-ads' })).toBe(true);
    for (const id of ['notion', 'google-calendar', 'chat', 'demo', 'timer']) expect(isClientConnector({ id })).toBe(false);
  });

  it('puts every other outside service on the team, and never a local widget', () => {
    for (const id of ['notion', 'google-calendar', 'chat']) expect(isTeamConnector(external(id))).toBe(true);
    expect(isTeamConnector(external('meta'))).toBe(false);
    expect(isTeamConnector(external('google-ads'))).toBe(false);
    expect(isTeamConnector({ id: 'timer', category: 'local' })).toBe(false);
  });
});
