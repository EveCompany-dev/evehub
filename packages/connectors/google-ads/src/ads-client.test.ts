import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GoogleAdsError, adsSearch, describeError, getAccessToken, resetTokenCacheForTests } from './ads-client';

const auth = {
  clientId: 'client-id-longo',
  clientSecret: 'client-secret',
  refreshToken: 'refresh-token-longo',
  developerToken: 'dev-token',
};

/** Minimal stand-in for the parts of Response this client touches. */
function reply(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) } as Response;
}

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  resetTokenCacheForTests();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

describe('getAccessToken', () => {
  it('trades the refresh token for an access token', async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { access_token: 'ya29.abc', expires_in: 3600 }));

    await expect(getAccessToken(auth)).resolves.toBe('ya29.abc');

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://oauth2.googleapis.com/token');
    expect(String((init as RequestInit).body)).toContain('grant_type=refresh_token');
  });

  it('reuses the cached token instead of paying for a round trip per sync', async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { access_token: 'ya29.abc', expires_in: 3600 }));

    const now = Date.now();
    await getAccessToken(auth, now);
    await expect(getAccessToken(auth, now + 60_000)).resolves.toBe('ya29.abc');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('renews shortly before the hour is up, never after', async () => {
    fetchMock
      .mockResolvedValueOnce(reply(200, { access_token: 'primeiro', expires_in: 3600 }))
      .mockResolvedValueOnce(reply(200, { access_token: 'segundo', expires_in: 3600 }));

    const now = Date.now();
    await getAccessToken(auth, now);
    // 59m30s in: still inside the hour, already past the safety margin.
    await expect(getAccessToken(auth, now + 3_570_000)).resolves.toBe('segundo');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('says what to do when the refresh token was revoked', async () => {
    fetchMock.mockResolvedValueOnce(reply(400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }));

    await expect(getAccessToken(auth)).rejects.toThrow(/revogado ou expirou/);
  });

  it('does not cache a failure', async () => {
    fetchMock
      .mockResolvedValueOnce(reply(400, { error: 'invalid_grant' }))
      .mockResolvedValueOnce(reply(200, { access_token: 'ya29.depois', expires_in: 3600 }));

    await expect(getAccessToken(auth)).rejects.toBeInstanceOf(GoogleAdsError);
    await expect(getAccessToken(auth)).resolves.toBe('ya29.depois');
  });
});

describe('adsSearch', () => {
  beforeEach(() => {
    fetchMock.mockResolvedValueOnce(reply(200, { access_token: 'ya29.abc', expires_in: 3600 }));
  });

  it('sends the developer token, the query, and the manager account when there is one', async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { results: [{ campaign: { id: '1' } }], nextPageToken: 'próxima' }));

    const response = await adsSearch(auth, {
      customerId: '1234567890',
      loginCustomerId: '9999999999',
      query: 'SELECT campaign.id FROM campaign',
      pageSize: 200,
    });

    expect(response.results).toHaveLength(1);
    expect(response.nextPageToken).toBe('próxima');

    const [url, init] = fetchMock.mock.calls[1]!;
    const request = init as RequestInit;
    expect(String(url)).toContain('/customers/1234567890/googleAds:search');
    expect(request.headers).toMatchObject({ Authorization: 'Bearer ya29.abc', 'developer-token': 'dev-token', 'login-customer-id': '9999999999' });
    expect(JSON.parse(String(request.body))).toEqual({ query: 'SELECT campaign.id FROM campaign', pageSize: 200 });
  });

  it('leaves login-customer-id out when the account is reached directly', async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { results: [] }));

    await adsSearch(auth, { customerId: '1234567890', query: 'SELECT campaign.id FROM campaign' });

    const headers = (fetchMock.mock.calls[1]![1] as RequestInit).headers as Record<string, string>;
    expect(headers['login-customer-id']).toBeUndefined();
  });

  it('surfaces the API failure instead of a bare status code', async () => {
    fetchMock.mockResolvedValueOnce(
      reply(400, {
        error: {
          code: 400,
          message: 'Request contains an invalid argument.',
          details: [{ errors: [{ message: 'Unrecognized field in the query: metrics.bogus' }] }],
        },
      }),
    );

    await expect(adsSearch(auth, { customerId: '1234567890', query: 'SELECT metrics.bogus FROM campaign' })).rejects.toThrow(
      /Unrecognized field/,
    );
  });
});

describe('describeError', () => {
  it('translates the failures people actually hit', () => {
    expect(describeError(401, {})).toMatch(/Reconecte a conta/);
    expect(describeError(403, { error: { message: 'The developer token is not approved' } })).toMatch(/developer token/);
    expect(describeError(403, { error: { message: 'User doesn\'t have permission' } })).toMatch(/Sem permissão/);
    expect(describeError(404, {})).toMatch(/GOOGLE_ADS_API_VERSION/);
    expect(describeError(429, {})).toMatch(/limitou a taxa/);
    expect(describeError(500, {})).toBe('O Google Ads respondeu HTTP 500.');
  });
});
