import { describe, expect, it } from 'vitest';
import { guessTagColor, hashTagColor, isTagColor, tagColorFor, TAG_COLORS } from './table-tags';

describe('tag colors', () => {
  it('colors status words by what they mean', () => {
    expect(guessTagColor('Ativa')).toBe('green');
    expect(guessTagColor('Publicado/Programado')).toBe('green');
    expect(guessTagColor('Cancelado')).toBe('red');
    expect(guessTagColor('NÃO FAZEMOS')).toBe('red');
    expect(guessTagColor('Ideia')).toBe('yellow');
    expect(guessTagColor('Em produção')).toBe('blue');
  });

  it("uses the team's content-format palette (Reels / Carrossel / Feed)", () => {
    expect(guessTagColor('Reels')).toBe('purple');
    expect(guessTagColor('Carrossel')).toBe('pink');
    expect(guessTagColor('Feed')).toBe('orange');
  });

  it('leaves unknown words to a stable hash', () => {
    expect(guessTagColor('Cris')).toBeNull();
    expect(hashTagColor('Cris')).toBe(hashTagColor('  cris '));
    expect(TAG_COLORS).toContain(hashTagColor('Ananda'));
  });

  it('prefers an explicit color, ignoring unknown ones', () => {
    expect(tagColorFor('Ativa', 'purple')).toBe('purple');
    expect(tagColorFor('Ativa', 'chartreuse')).toBe('green');
    expect(isTagColor('pink')).toBe(true);
    expect(isTagColor('nope')).toBe(false);
  });
});
