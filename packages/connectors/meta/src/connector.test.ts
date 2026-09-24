import { describe, expect, it } from 'vitest';
import { metaConnector } from './connector';

describe('Meta config', () => {
  const parse = (config: unknown) => metaConnector.configSchema.safeParse(config);

  it('accepts numeric ids, trimming what older setups stored', () => {
    expect(parse({ pageId: ' 1234567890 ', instagramBusinessAccountId: '17841400000000000' }).data).toEqual({
      pageId: '1234567890',
      instagramBusinessAccountId: '17841400000000000',
    });
  });

  it('reads an empty Instagram id as not set', () => {
    const result = parse({ pageId: '123', instagramBusinessAccountId: '' });
    expect(result.success).toBe(true);
    expect(result.data?.instagramBusinessAccountId).toBeUndefined();
  });

  it('refuses an id carrying a path or query', () => {
    expect(parse({ pageId: 'me/accounts?fields=access_token&x=' }).success).toBe(false);
    expect(parse({ pageId: '123', instagramBusinessAccountId: '1/../me' }).success).toBe(false);
  });
});
