import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { extractPreview, fetchLinkPreview, isPrivateAddress, type Resolver } from './link-preview';

describe('isPrivateAddress', () => {
  it('refuses loopback, private, link-local and reserved addresses', () => {
    for (const address of ['127.0.0.1', '10.1.2.3', '192.168.0.10', '172.16.5.5', '172.31.255.255', '169.254.169.254', '0.0.0.0', '100.64.0.1', '224.0.0.1', '::1', 'fe80::1', 'fd00::1', '::ffff:127.0.0.1']) {
      expect(isPrivateAddress(address), address).toBe(true);
    }
  });

  it('refuses IPv4-mapped addresses in the hex form a URL actually produces', () => {
    // The literals below are what `new URL('http://[::ffff:169.254.169.254]/')`
    // hands back — URL normalizes an IPv6 host to hex. Asserting only the
    // dotted spelling is what let this through: these three reached cloud
    // metadata, loopback and RFC1918 respectively.
    for (const [typed, normalized] of [
      ['http://[::ffff:169.254.169.254]/', '::ffff:a9fe:a9fe'],
      ['http://[::ffff:127.0.0.1]/', '::ffff:7f00:1'],
      ['http://[::ffff:10.0.0.1]/', '::ffff:a00:1'],
    ] as const) {
      expect(new URL(typed).hostname, typed).toBe(`[${normalized}]`);
      expect(isPrivateAddress(normalized), normalized).toBe(true);
    }
  });

  it('refuses the expanded spelling of loopback and the unspecified address', () => {
    expect(isPrivateAddress(new URL('http://[0:0:0:0:0:0:0:1]/').hostname.replace(/^\[|\]$/g, ''))).toBe(true);
    expect(isPrivateAddress(new URL('http://[0:0:0:0:0:0:0:0]/').hostname.replace(/^\[|\]$/g, ''))).toBe(true);
  });

  it('allows public addresses', () => {
    for (const address of ['8.8.8.8', '157.240.1.35', '172.32.0.1', '2606:4700:4700::1111']) {
      expect(isPrivateAddress(address), address).toBe(false);
    }
  });

  it('refuses anything that is not an IP at all', () => {
    expect(isPrivateAddress('localhost')).toBe(true);
  });
});

describe('extractPreview', () => {
  it('reads og:image and og:title, whatever the attribute order', () => {
    const html = '<head><title>Fallback</title><meta property="og:title" content="Post &amp; Cia"><meta content="https://cdn.example.com/a.jpg?x=1&amp;y=2" property="og:image"></head>';
    expect(extractPreview(html, 'https://www.example.com/p/abc')).toEqual({
      image: 'https://cdn.example.com/a.jpg?x=1&y=2',
      title: 'Post & Cia',
      site: 'example.com',
    });
  });

  it('resolves a relative image against the page and falls back to twitter:image and <title>', () => {
    const html = '<title> Só o título </title><meta name="twitter:image" content="/img/capa.png">';
    expect(extractPreview(html, 'https://loja.example.com/produto/1')).toEqual({
      image: 'https://loja.example.com/img/capa.png',
      title: 'Só o título',
      site: 'loja.example.com',
    });
  });

  it('never returns a non-http image (javascript:, data:)', () => {
    expect(extractPreview('<meta property="og:image" content="javascript:alert(1)">', 'https://a.example/').image).toBeNull();
    expect(extractPreview('<meta property="og:image" content="data:image/png;base64,AAAA">', 'https://a.example/').image).toBeNull();
  });

  it('has no image when the page declares none', () => {
    expect(extractPreview('<html><head></head></html>', 'https://a.example/').image).toBeNull();
  });
});

describe('fetchLinkPreview', () => {
  // A page on loopback that must never be reached: every request to it is counted.
  let server: Server;
  let port = 0;
  let hits = 0;

  beforeAll(async () => {
    server = createServer((_request, response) => {
      hits += 1;
      response.writeHead(200, { 'Content-Type': 'text/html' });
      response.end('<head><meta property="og:title" content="interno"></head>');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('connects to the address it checked, even when the name answers differently the second time', async () => {
    hits = 0;
    const answers = [
      [{ address: '198.51.100.7', family: 4 }],
      [{ address: '127.0.0.1', family: 4 }],
    ];
    let calls = 0;
    const resolve: Resolver = async () => answers[Math.min(calls++, answers.length - 1)]!;

    await expect(fetchLinkPreview(`http://rebind.example:${port}/`, { resolve, timeoutMs: 500 })).rejects.toThrow('Não foi possível ler este link.');
    expect(hits).toBe(0);
    // One resolution per connection: there is no second answer for a check to disagree with.
    expect(calls).toBe(1);
  });

  it('refuses a name that resolves to loopback without ever connecting', async () => {
    hits = 0;
    const resolve: Resolver = async () => [{ address: '127.0.0.1', family: 4 }];
    await expect(fetchLinkPreview(`http://local.example:${port}/`, { resolve, timeoutMs: 500 })).rejects.toThrow('Não foi possível ler este link.');
    expect(hits).toBe(0);
  });

  it('refuses when any of several answers is private', async () => {
    hits = 0;
    const resolve: Resolver = async () => [
      { address: '198.51.100.7', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ];
    await expect(fetchLinkPreview(`http://mixed.example:${port}/`, { resolve, timeoutMs: 500 })).rejects.toThrow('Não foi possível ler este link.');
    expect(hits).toBe(0);
  });

  it('refuses a private IP literal, and fails every way with the same message', async () => {
    await expect(fetchLinkPreview(`http://127.0.0.1:${port}/`)).rejects.toThrow('Não foi possível ler este link.');
    await expect(fetchLinkPreview('ftp://example.com/')).rejects.toThrow('Não foi possível ler este link.');
    expect(hits).toBe(0);
  });
});
