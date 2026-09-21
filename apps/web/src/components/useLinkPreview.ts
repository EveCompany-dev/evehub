'use client';

import { useEffect, useState } from 'react';

export interface LinkPreviewInfo {
  image: string | null;
  title: string | null;
  site: string;
}

// One request per link for the life of the page, however many cards ask.
const inflight = new Map<string, Promise<LinkPreviewInfo | null>>();

function load(url: string): Promise<LinkPreviewInfo | null> {
  const existing = inflight.get(url);
  if (existing) return existing;
  const request = fetch(`/api/link-preview?url=${encodeURIComponent(url)}`)
    .then((response) => (response.ok ? (response.json() as Promise<{ preview: LinkPreviewInfo | null }>) : null))
    .then((body) => body?.preview ?? null)
    .catch(() => null);
  inflight.set(url, request);
  return request;
}

/** The picture a link declares for itself, or null while loading / when there is none. */
export function useLinkPreview(url: string | null): { preview: LinkPreviewInfo | null; loading: boolean } {
  const [state, setState] = useState<{ url: string | null; preview: LinkPreviewInfo | null; done: boolean }>({ url: null, preview: null, done: false });

  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    void load(url).then((preview) => {
      if (!cancelled) setState({ url, preview, done: true });
    });
    return () => {
      cancelled = true;
    };
  }, [url]);

  const current = state.url === url;
  return { preview: current ? state.preview : null, loading: Boolean(url) && !(current && state.done) };
}
