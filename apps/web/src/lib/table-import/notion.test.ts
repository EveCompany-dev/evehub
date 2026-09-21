import { describe, expect, it } from 'vitest';
import { groupNotionCsvs, parseNotionFileName, type CsvSource } from './notion';

const source = (path: string): CsvSource => ({ path, bytes: new Uint8Array() });

describe('parseNotionFileName', () => {
  it('strips the Notion id and recognizes the _all variant', () => {
    expect(parseNotionFileName('Social Media Clientes 1352754f44e8804395bcf69a5c7d834a.csv')).toMatchObject({
      title: 'Social Media Clientes',
      variant: 'visible',
    });
    expect(parseNotionFileName('Export/Eve/Social Media Clientes 1352754f44e8804395bcf69a5c7d834a_all.csv')).toMatchObject({
      title: 'Social Media Clientes',
      variant: 'all',
    });
  });

  it('accepts any CSV, with or without a Notion id', () => {
    expect(parseNotionFileName('clientes.csv')).toMatchObject({ title: 'clientes', variant: 'visible' });
    expect(parseNotionFileName('clientes_all.csv')).toMatchObject({ title: 'clientes', variant: 'all' });
  });
});

describe('groupNotionCsvs', () => {
  it('pairs each database\'s visible and _all files', () => {
    const groups = groupNotionCsvs([
      source('A/Postagens aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.csv'),
      source('A/Postagens aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa_all.csv'),
      source('A/Ideias bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.csv'),
    ]);
    expect(groups.map((group) => [group.title, Boolean(group.visible), Boolean(group.all)])).toEqual([
      ['Ideias', true, false],
      ['Postagens', true, true],
    ]);
  });

  it('keeps same-named databases from different folders apart', () => {
    const groups = groupNotionCsvs([source('A/Postagens aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.csv'), source('B/Postagens aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.csv')]);
    expect(groups).toHaveLength(2);
  });

  it('does not lose a second file of the same variant', () => {
    const groups = groupNotionCsvs([source('a.csv'), source('a.csv')]);
    expect(groups).toHaveLength(2);
  });
});
