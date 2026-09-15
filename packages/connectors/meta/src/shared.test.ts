import { describe, expect, it } from 'vitest';
import { ALL_TARGETS, mediaKindFromUrl, targetAcceptsMedia, targetLabel, type PostTarget } from './shared';

const target = (platform: PostTarget['platform'], postType: PostTarget['postType']): PostTarget => ({
  platform,
  postType,
});

describe('mediaKindFromUrl', () => {
  it.each(['a.mp4', 'a.MOV', 'a.m4v', 'a.webm'])('treats %s as video', (name) => {
    expect(mediaKindFromUrl(`https://x.test/uploads/${name}`)).toBe('video');
  });

  it.each(['a.png', 'a.jpg', 'a.webp', 'a.gif'])('treats %s as image', (name) => {
    expect(mediaKindFromUrl(`https://x.test/uploads/${name}`)).toBe('image');
  });

  it('ignores a query string when reading the extension', () => {
    expect(mediaKindFromUrl('https://x.test/a.mp4?v=2')).toBe('video');
  });

  it('falls back to image for an extensionless URL', () => {
    expect(mediaKindFromUrl('https://x.test/uploads/blob')).toBe('image');
  });
});

/**
 * These encode Meta's rules, not preferences: a Reel is video by definition,
 * an Instagram feed video is a Reel as far as the API is concerned, and the
 * Facebook video endpoints use a resumable upload protocol this app does not
 * implement — so accepting a video there would only fail at publish time.
 */
describe('targetAcceptsMedia', () => {
  it('allows an image on every target except Reels', () => {
    for (const candidate of ALL_TARGETS) {
      expect(targetAcceptsMedia(candidate, 'image')).toBe(candidate.postType !== 'reel');
    }
  });

  it('allows video only on Instagram Reels and Instagram Stories', () => {
    expect(targetAcceptsMedia(target('instagram', 'reel'), 'video')).toBe(true);
    expect(targetAcceptsMedia(target('instagram', 'story'), 'video')).toBe(true);
    expect(targetAcceptsMedia(target('instagram', 'feed'), 'video')).toBe(false);
    expect(targetAcceptsMedia(target('facebook', 'feed'), 'video')).toBe(false);
    expect(targetAcceptsMedia(target('facebook', 'story'), 'video')).toBe(false);
  });

  it('never accepts a Facebook reel, which does not exist here', () => {
    expect(targetAcceptsMedia(target('facebook', 'reel'), 'video')).toBe(false);
    expect(targetAcceptsMedia(target('facebook', 'reel'), 'image')).toBe(false);
  });
});

describe('ALL_TARGETS', () => {
  it('offers the five real destinations, with no duplicates', () => {
    expect(ALL_TARGETS).toHaveLength(5);
    expect(new Set(ALL_TARGETS.map((item) => `${item.platform}:${item.postType}`)).size).toBe(5);
  });

  it('every offered target accepts at least one kind of media', () => {
    for (const candidate of ALL_TARGETS) {
      expect(targetAcceptsMedia(candidate, 'image') || targetAcceptsMedia(candidate, 'video')).toBe(true);
    }
  });

  it('labels each target the way the editor shows it', () => {
    expect(targetLabel(target('instagram', 'reel'))).toBe('Instagram Reels');
    expect(targetLabel(target('facebook', 'feed'))).toBe('Facebook Post');
    expect(targetLabel(target('instagram', 'story'))).toBe('Instagram Story');
  });
});
