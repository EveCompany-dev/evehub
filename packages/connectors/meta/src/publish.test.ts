import { describe, expect, it } from 'vitest';
import { assertMediaUrlIsPublic } from './publish';

/**
 * These rules exist because Meta downloads post media from the URL we hand
 * it: anything that only resolves inside this machine or network publishes
 * nothing, and Meta reports it as "Only photo or video can be accepted as
 * media type" — an error about file formats, for what is actually an
 * unreachable address.
 */
describe('assertMediaUrlIsPublic', () => {
  it('accepts a public https URL', () => {
    expect(() => assertMediaUrlIsPublic('https://hub.evecompany.com.br/uploads/post-media/a.png')).not.toThrow();
  });

  it('accepts a public host on a non-default port', () => {
    expect(() => assertMediaUrlIsPublic('http://203.0.113.10:3000/uploads/a.png')).not.toThrow();
  });

  it.each([
    ['localhost', 'http://localhost:3000/uploads/a.png'],
    ['loopback IP', 'http://127.0.0.1:3002/uploads/a.png'],
    ['0.0.0.0', 'http://0.0.0.0:3000/uploads/a.png'],
    ['IPv6 loopback', 'http://[::1]:3000/uploads/a.png'],
    ['mDNS .local', 'http://pc09.local:3000/uploads/a.png'],
    ['RFC1918 10/8', 'http://10.0.0.5/uploads/a.png'],
    ['RFC1918 192.168/16', 'http://192.168.1.20:3000/uploads/a.png'],
    ['RFC1918 172.16/12', 'http://172.20.0.3/uploads/a.png'],
    ['link-local', 'http://169.254.1.1/uploads/a.png'],
    ['CGNAT/tailnet', 'http://100.117.211.36:3002/uploads/a.png'],
  ])('rejects %s', (_label, url) => {
    expect(() => assertMediaUrlIsPublic(url)).toThrow(/não consegue baixar/i);
  });

  it('does not mistake a public address for a private one on the 172 boundary', () => {
    expect(() => assertMediaUrlIsPublic('http://172.32.0.1/uploads/a.png')).not.toThrow();
    expect(() => assertMediaUrlIsPublic('http://172.15.0.1/uploads/a.png')).not.toThrow();
  });

  it('rejects a non-http scheme', () => {
    expect(() => assertMediaUrlIsPublic('file:///C:/uploads/a.png')).toThrow(/http/i);
  });

  it('rejects a malformed URL', () => {
    expect(() => assertMediaUrlIsPublic('/uploads/post-media/a.png')).toThrow(/inválida/i);
  });
});
