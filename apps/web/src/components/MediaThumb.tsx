'use client';

import { mediaKindFromUrl } from '@eve/connector-meta/shared';
import type { JSX } from 'react';

/**
 * A Reel's media is video, and a <img src="...mp4"> is just a broken image —
 * so every place a post thumbnail appears has to branch on the media kind.
 */
export function MediaThumb({ url, className }: { url: string; className: string }): JSX.Element {
  if (mediaKindFromUrl(url) === 'video') return <video className={className} src={url} muted playsInline preload="metadata" />;
  // eslint-disable-next-line @next/next/no-img-element -- uploaded URL, not a static asset.
  return <img className={className} src={url} alt="" />;
}
