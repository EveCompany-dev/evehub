import { createElement, Fragment } from 'react';
import { describe, expect, it } from 'vitest';
import { hasRenderableContent, visibleSettingsPages } from './widget-settings-pages';

function Section(): null {
  return null;
}

describe('widget settings pages', () => {
  it('shows only the pages a widget gave content, in the fixed order', () => {
    expect(visibleSettingsPages({ conexao: createElement(Section), geral: createElement(Section) })).toEqual(['geral', 'conexao']);
    expect(visibleSettingsPages({ estilo: 'Cor', geral: createElement(Section), conexao: createElement(Section) })).toEqual([
      'geral',
      'estilo',
      'conexao',
    ]);
  });

  it('leaves out a page with nothing in it', () => {
    expect(
      visibleSettingsPages({
        geral: null,
        estilo: undefined,
        conexao: false,
      }),
    ).toEqual([]);
    expect(visibleSettingsPages({ geral: createElement(Fragment, null, null, false, '  ') })).toEqual([]);
    expect(visibleSettingsPages({ geral: [null, [undefined, false]] })).toEqual([]);
    expect(visibleSettingsPages(undefined)).toEqual([]);
  });

  it('counts a component, text, a number or a non-empty fragment as content', () => {
    expect(hasRenderableContent(createElement(Section))).toBe(true);
    expect(hasRenderableContent('Pomodoro')).toBe(true);
    expect(hasRenderableContent(0)).toBe(true);
    expect(hasRenderableContent(createElement(Fragment, null, null, createElement(Section)))).toBe(true);
    expect(hasRenderableContent([null, 'x'])).toBe(true);
  });

  it('keeps Geral for a widget still on the old actions menu, even with no page content', () => {
    expect(visibleSettingsPages(undefined, 2)).toEqual(['geral']);
    expect(visibleSettingsPages({ estilo: createElement(Section) }, 1)).toEqual(['geral', 'estilo']);
    expect(visibleSettingsPages({ estilo: createElement(Section) }, 0)).toEqual(['estilo']);
  });
});
