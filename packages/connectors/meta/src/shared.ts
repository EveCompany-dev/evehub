/**
 * Client-safe half of the connector: no token, no network. The scheduling UI
 * imports from here; the actual Graph API calls live in graph-client.ts and
 * publish.ts (server-only).
 */
export const PLATFORMS = ['instagram', 'facebook'] as const;
export type Platform = (typeof PLATFORMS)[number];

/**
 * Pinned Graph API version. Meta retires versions on a roughly two-year
 * cadence — check developers.facebook.com/docs/graph-api/changelog before
 * this stops being current, this is a conscious upgrade, not a side effect.
 */
export const GRAPH_VERSION = 'v23.0';

export const POST_TYPES = ['feed', 'story', 'reel'] as const;
export type PostTypeName = (typeof POST_TYPES)[number];

/** One place a post can go. A single editor submit can produce several. */
export interface PostTarget {
  platform: Platform;
  postType: PostTypeName;
}

export type MediaKind = 'image' | 'video';

const VIDEO_EXTENSIONS = ['.mp4', '.mov', '.m4v', '.webm'];

/**
 * Media kind by file extension. The uploader controls these names (a random
 * id plus the original extension), and the alternative — a HEAD request per
 * check — would make a synchronous form validation do network I/O.
 */
export function mediaKindFromUrl(url: string): MediaKind {
  const path = url.split('?')[0]?.toLowerCase() ?? '';
  return VIDEO_EXTENSIONS.some((extension) => path.endsWith(extension)) ? 'video' : 'image';
}

/**
 * Which targets accept which media. These are Meta's rules, not ours:
 *
 * - Reels are video by definition.
 * - Instagram feed images go up as a plain image container; a *video* in the
 *   feed is a Reel as far as the API is concerned, so we do not pretend to
 *   support it here and ask for the Reel target instead.
 * - Instagram Stories take either.
 * - Facebook feed and Stories are image-only in this app: their video paths
 *   use a resumable upload protocol that nothing here implements yet, and
 *   quietly accepting a video would just fail at publish time.
 */
export function targetAcceptsMedia(target: PostTarget, kind: MediaKind): boolean {
  if (target.platform === 'instagram') {
    if (target.postType === 'reel') return kind === 'video';
    if (target.postType === 'story') return true;
    return kind === 'image';
  }
  // Facebook
  if (target.postType === 'reel') return false;
  return kind === 'image';
}

export function targetLabel(target: PostTarget): string {
  const platform = target.platform === 'instagram' ? 'Instagram' : 'Facebook';
  const type = target.postType === 'feed' ? 'Post' : target.postType === 'story' ? 'Story' : 'Reels';
  return `${platform} ${type}`;
}

/** Every target the editor offers, in the order it shows them. */
export const ALL_TARGETS: PostTarget[] = [
  { platform: 'instagram', postType: 'feed' },
  { platform: 'instagram', postType: 'story' },
  { platform: 'instagram', postType: 'reel' },
  { platform: 'facebook', postType: 'feed' },
  { platform: 'facebook', postType: 'story' },
];
