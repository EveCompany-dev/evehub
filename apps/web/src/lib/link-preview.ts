import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/**
 * Link previews for gallery covers: fetch a page and read the picture it
 * declares for itself (og:image / twitter:image). This is a server-side fetch
 * of a URL a user typed, so it is the classic SSRF shape — every hop is
 * checked against private/loopback/link-local ranges before it is followed.
 */

export interface LinkPreview {
  image: string | null;
  title: string | null;
  /** Host shown when there is no picture ("instagram.com"). */
  site: string;
}

const MAX_BYTES = 512 * 1024;
const TIMEOUT_MS = 5000;
const MAX_REDIRECTS = 3;

/** True for addresses a public link must never resolve to. */
export function isPrivateAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const [a, b] = address.split('.').map(Number) as [number, number];
    return (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      a >= 224
    );
  }
  if (family === 6) {
    // IPv6 is allowlisted, not blocklisted: only 2000::/3 is global unicast,
    // so everything else — loopback, unique-local, link-local, multicast, and
    // IPv4-mapped in any spelling — is refused by default.
    //
    // Enumerating the bad ranges is what went wrong here before. The check
    // matched IPv4-mapped addresses in their dotted form
    // (`::ffff:169.254.169.254`), but WHATWG URL normalizes an IPv6 host to
    // hex, so a typed `http://[::ffff:169.254.169.254]/` arrives as
    // `::ffff:a9fe:a9fe` — which the pattern missed, letting loopback,
    // RFC1918 and the cloud metadata address straight through. A test asserted
    // the dotted form and passed, because that form never reaches this
    // function from a URL.
    return !/^[23]/.test(address.toLowerCase());
  }
  return true;
}

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function metaContent(html: string, keys: string[]): string | null {
  for (const key of keys) {
    // Either attribute order: <meta property="og:image" content="..."> or content first.
    const patterns = [
      new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]*content=["']([^"']+)["']`, 'i'),
      new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${key}["']`, 'i'),
    ];
    for (const pattern of patterns) {
      const match = pattern.exec(html);
      if (match?.[1]) return decodeEntities(match[1].trim());
    }
  }
  return null;
}

/** Reads the preview picture and title out of a page's HTML; relative image URLs resolve against `pageUrl`. */
export function extractPreview(html: string, pageUrl: string): LinkPreview {
  const site = new URL(pageUrl).hostname.replace(/^www\./, '');
  const rawImage = metaContent(html, ['og:image:secure_url', 'og:image', 'twitter:image', 'twitter:image:src']);
  let image: string | null = null;
  if (rawImage) {
    try {
      const resolved = new URL(rawImage, pageUrl);
      if (resolved.protocol === 'https:' || resolved.protocol === 'http:') image = resolved.toString();
    } catch {
      image = null;
    }
  }
  const title = metaContent(html, ['og:title', 'twitter:title']) ?? decodeEntities(/<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1]?.trim() ?? '') ?? null;
  return { image, title: title || null, site };
}

async function assertPublic(url: URL): Promise<void> {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Só links http(s).');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (addresses.length === 0 || addresses.some((entry) => isPrivateAddress(entry.address))) throw new Error('Endereço não permitido.');
}

/** Fetches the page (following a few redirects, re-checking each) and extracts its preview. */
export async function fetchLinkPreview(rawUrl: string): Promise<LinkPreview> {
  let url = new URL(rawUrl);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    await assertPublic(url);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        redirect: 'manual',
        signal: controller.signal,
        headers: { 'User-Agent': 'EveHub-LinkPreview/1.0', Accept: 'text/html,application/xhtml+xml' },
      });
      if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
        url = new URL(response.headers.get('location')!, url);
        continue;
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      if (!(response.headers.get('content-type') ?? '').includes('html')) return { image: null, title: null, site: url.hostname.replace(/^www\./, '') };

      // Read at most MAX_BYTES: the tags live in <head>, and a hostile page must not be able to make us buffer gigabytes.
      const reader = response.body?.getReader();
      let html = '';
      let received = 0;
      const decoder = new TextDecoder('utf-8');
      while (reader && received < MAX_BYTES) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.length;
        html += decoder.decode(value, { stream: true });
        if (/<\/head>/i.test(html)) break;
      }
      void reader?.cancel().catch(() => undefined);
      return extractPreview(html, url.toString());
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error('Redirecionamentos demais.');
}
