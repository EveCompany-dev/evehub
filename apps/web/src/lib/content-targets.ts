import type { PostTarget } from '@eve/connector-meta/shared';
import { fold } from './fold';

/**
 * How a Calendário de Conteúdo row (Canal + Formato) maps to where a post
 * goes, both ways: opening "Agendar post" from a row pre-picks the
 * destination, and a post written in Agendar Post fills the row it creates.
 * Pure and browser-safe — the composer and the API both use it.
 */

function foldField(value: unknown): string {
  return typeof value === 'string' ? fold(value).trim() : '';
}

/** The destination a row asks for; Instagram Feed when it names nothing Meta publishes. */
export function targetFromContent(canal: unknown, formato: unknown): { target: PostTarget; carousel: boolean } {
  const platform = foldField(canal) === 'facebook' ? 'facebook' : 'instagram';
  const format = foldField(formato);
  if (format.startsWith('reel')) return { target: { platform: 'instagram', postType: 'reel' }, carousel: false };
  if (format.startsWith('stor')) return { target: { platform, postType: 'story' }, carousel: false };
  // Carousels only exist on the Instagram feed.
  if (format.startsWith('carross') || format.startsWith('carous')) return { target: { platform: 'instagram', postType: 'feed' }, carousel: true };
  return { target: { platform, postType: 'feed' }, carousel: false };
}

/** Canal and Formato for the row a post creates. */
export function contentFieldsFor(target: PostTarget, carousel: boolean): { canal: string; formato: string } {
  const canal = target.platform === 'facebook' ? 'Facebook' : 'Instagram';
  const formato = target.postType === 'reel' ? 'Reels' : target.postType === 'story' ? 'Stories' : carousel ? 'Carrossel' : 'Feed';
  return { canal, formato };
}

/** A row title from the caption's first line, or `fallback` for a caption-less post (a story). */
export function contentTitleFrom(caption: string, fallback: string): string {
  const line = caption
    .split('\n')
    .map((part) => part.trim())
    .find(Boolean);
  if (!line) return fallback;
  return line.length > 80 ? `${line.slice(0, 79).trimEnd()}…` : line;
}
