import { describe, expect, it } from 'vitest';
import { contentFieldsFor, contentTitleFrom, targetFromContent } from './content-targets';

describe('targetFromContent', () => {
  it('maps the Notion formats to where Meta publishes them', () => {
    expect(targetFromContent('Instagram', 'Reels')).toEqual({ target: { platform: 'instagram', postType: 'reel' }, carousel: false });
    expect(targetFromContent('Instagram', 'Carrossel')).toEqual({ target: { platform: 'instagram', postType: 'feed' }, carousel: true });
    expect(targetFromContent('Instagram', 'Stories')).toEqual({ target: { platform: 'instagram', postType: 'story' }, carousel: false });
    expect(targetFromContent('Facebook', 'Feed')).toEqual({ target: { platform: 'facebook', postType: 'feed' }, carousel: false });
    expect(targetFromContent('Facebook', 'Stories')).toEqual({ target: { platform: 'facebook', postType: 'story' }, carousel: false });
  });

  it('falls back to the Instagram feed for anything else', () => {
    expect(targetFromContent('TikTok', '')).toEqual({ target: { platform: 'instagram', postType: 'feed' }, carousel: false });
    expect(targetFromContent(undefined, null)).toEqual({ target: { platform: 'instagram', postType: 'feed' }, carousel: false });
  });
});

describe('contentFieldsFor', () => {
  it('is the inverse for what a row can say', () => {
    expect(contentFieldsFor({ platform: 'instagram', postType: 'feed' }, true)).toEqual({ canal: 'Instagram', formato: 'Carrossel' });
    expect(contentFieldsFor({ platform: 'instagram', postType: 'reel' }, false)).toEqual({ canal: 'Instagram', formato: 'Reels' });
    expect(contentFieldsFor({ platform: 'facebook', postType: 'story' }, false)).toEqual({ canal: 'Facebook', formato: 'Stories' });
  });
});

describe('contentTitleFrom', () => {
  it('uses the first non-empty line of the caption', () => {
    expect(contentTitleFrom('\n  Café novo chegou!  \nVenha provar', 'Post')).toBe('Café novo chegou!');
  });

  it('shortens a long line and falls back when there is no caption', () => {
    expect(contentTitleFrom('a'.repeat(100), 'Post')).toHaveLength(80);
    expect(contentTitleFrom('', 'Instagram Story de Acme')).toBe('Instagram Story de Acme');
  });
});
