import { describe, expect, it } from 'vitest';
import { isClientConnector, isTeamConnector } from './connector-scope';

const external = (id: string) => ({ id, category: 'external' });

describe('connector scope', () => {
  it('gives a client only its social media', () => {
    expect(isClientConnector({ id: 'meta' })).toBe(true);
    for (const id of ['notion', 'google-calendar', 'google-ads', 'chat', 'demo', 'timer']) expect(isClientConnector({ id })).toBe(false);
  });

  it('puts every other outside service on the team, and never a local widget', () => {
    for (const id of ['notion', 'google-calendar', 'google-ads', 'chat']) expect(isTeamConnector(external(id))).toBe(true);
    expect(isTeamConnector(external('meta'))).toBe(false);
    expect(isTeamConnector({ id: 'timer', category: 'local' })).toBe(false);
  });
});
