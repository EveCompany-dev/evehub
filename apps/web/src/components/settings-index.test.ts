import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SETTINGS_OPTIONS, settingsHref } from './settings-index';

const sectionsSource = readFileSync(path.join(__dirname, 'SettingsSections.tsx'), 'utf8');

/**
 * The palette's whole promise is landing the user *on the control*, so an
 * option with no anchor — or an anchor nobody indexes — is a silent dead
 * link: the page opens and nothing highlights.
 *
 * Checked by reading SettingsSections.tsx as text rather than importing it:
 * the suite runs in a plain Node environment with no JSX transform, and the
 * pairing being verified is a fact about that file's markup anyway.
 */
describe('settings index', () => {
  it('has a rendered anchor for every indexed option', () => {
    const missing = SETTINGS_OPTIONS.filter((option) => !sectionsSource.includes(`data-setting-id="${option.id}"`));
    expect(missing.map((option) => option.id)).toEqual([]);
  });

  it('indexes every rendered anchor', () => {
    const rendered = [...sectionsSource.matchAll(/data-setting-id="([^"]+)"/g)].map((match) => match[1]);
    const indexed = new Set(SETTINGS_OPTIONS.map((option) => option.id));

    expect(rendered.filter((id) => !indexed.has(id!))).toEqual([]);
  });

  it('points every option at a category that exists', () => {
    const block = sectionsSource.slice(sectionsSource.indexOf('SETTINGS_CATEGORIES'));
    const categories = new Set([...block.matchAll(/\{ id: '([^']+)'/g)].map((match) => match[1]));

    expect(categories.size).toBeGreaterThan(0);
    expect(SETTINGS_OPTIONS.filter((option) => !categories.has(option.category)).map((option) => option.id)).toEqual([]);
  });

  it('builds a deep link carrying both the category and the control', () => {
    const option = SETTINGS_OPTIONS.find((candidate) => candidate.id === 'uiScale')!;
    expect(settingsHref(option)).toBe('/settings?category=interface&option=uiScale');
  });

  it('has no duplicate ids', () => {
    const ids = SETTINGS_OPTIONS.map((option) => option.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
