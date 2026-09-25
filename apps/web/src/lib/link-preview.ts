import { lookup } from 'node:dns/promises';
import type { LookupAddress } from 'node:dns';
import { isIP, type LookupFunction } from 'node:net';
import { Agent, fetch } from 'undici';

/**
 * Link previews for gallery covers: fetch a page and read the picture it
 * declares for itself (og:image / twitter:image). This is a server-side fetch
 * of a URL a user typed, so it is the classic SSRF shape — every hop is
 * checked against private/loopback/link-local ranges before it is followed.
 *
 * The check runs inside the socket's own DNS lookup, not before the request:
 * resolving a name once to check it and letting fetch resolve it again to
 * connect would let the second answer differ from the first. Here the address
 * that was checked is the address the connection goes to.
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

/** Resolves every address a host name points to. Swappable so tests don't touch real DNS. */
export type Resolver = (host: string) => Promise<LookupAddress[]>;

const systemResolver: Resolver = (host) => lookup(host, { all: true });

/** One answer for every way a preview can fail, so a caller learns nothing about what is behind a link. */
const FAILED = 'Não foi possível ler este link.';

function assertAllowedUrl(url: URL): void {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error(FAILED);
  // An IP literal never reaches the socket lookup below, so it is checked here.
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host) && isPrivateAddress(host)) throw new Error(FAILED);
}

/** A `net` lookup that only ever hands the socket public addresses. */
function publicOnlyLookup(resolve: Resolver): LookupFunction {
  return (hostname, options, callback) => {
    resolve(hostname).then(
      (addresses) => {
        if (addresses.length === 0 || addresses.some((entry) => isPrivateAddress(entry.address))) {
          callback(Object.assign(new Error(FAILED), { code: 'ENOTFOUND' }), '', 0);
          return;
        }
        const wanted = options.family === 4 || options.family === 6 ? addresses.filter((entry) => entry.family === options.family) : addresses;
        if (wanted.length === 0) {
          callback(Object.assign(new Error(FAILED), { code: 'ENOTFOUND' }), '', 0);
          return;
        }
        if (options.all) {
          (callback as unknown as (error: null, addresses: LookupAddress[]) => void)(null, wanted);
        } else {
          callback(null, wanted[0]!.address, wanted[0]!.family);
        }
      },
      (error: unknown) => callback(Object.assign(new Error(FAILED), { code: (error as NodeJS.ErrnoException).code ?? 'ENOTFOUND' }), '', 0),
    );
  };
}

/** Fetches the page (following a few redirects, re-checking each) and extracts its preview. */
export async function fetchLinkPreview(rawUrl: string, options: { resolve?: Resolver; timeoutMs?: number } = {}): Promise<LinkPreview> {
  const timeoutMs = options.timeoutMs ?? TIMEOUT_MS;
  const dispatcher = new Agent({ connect: { lookup: publicOnlyLookup(options.resolve ?? systemResolver), timeout: timeoutMs } });
  try {
    return await followAndExtract(new URL(rawUrl), dispatcher, timeoutMs);
  } catch {
    throw new Error(FAILED);
  } finally {
    void dispatcher.close().catch(() => undefined);
  }
}

async function followAndExtract(start: URL, dispatcher: Agent, timeoutMs: number): Promise<LinkPreview> {
  let url = start;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    assertAllowedUrl(url);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        dispatcher,
        redirect: 'manual',
        signal: controller.signal,
        headers: { 'User-Agent': 'EveHub-LinkPreview/1.0', Accept: 'text/html,application/xhtml+xml' },
      });
      if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
        url = new URL(response.headers.get('location')!, url);
        void response.body?.cancel().catch(() => undefined);
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
