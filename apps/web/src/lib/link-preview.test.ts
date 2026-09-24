import { describe, expect, it } from 'vitest';
import { extractPreview, isPrivateAddress } from './link-preview';

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
