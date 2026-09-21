import { describe, expect, it } from 'vitest';
import { decodeCsvBytes, detectDelimiter, parseCsv } from './csv';

describe('parseCsv', () => {
  it('handles quotes, escaped quotes, embedded newlines and CRLF', () => {
    const { rows } = parseCsv('a,b,c\r\n"x, y","say ""hi""","line1\nline2"\r\n1,2,3');
    expect(rows).toEqual([
      ['a', 'b', 'c'],
      ['x, y', 'say "hi"', 'line1\nline2'],
      ['1', '2', '3'],
    ]);
  });

  it('strips a BOM and drops fully blank rows', () => {
    const { rows } = parseCsv('﻿Name,Age\n\nAna,30\n,\nBia,25\n');
    expect(rows).toEqual([
      ['Name', 'Age'],
      ['Ana', '30'],
      ['Bia', '25'],
    ]);
  });

  it('keeps empty cells and a trailing empty field', () => {
    expect(parseCsv('a,b,c\n1,,\n,,3').rows).toEqual([
      ['a', 'b', 'c'],
      ['1', '', ''],
      ['', '', '3'],
    ]);
  });

  it('detects ; (Excel pt-BR) and tab delimiters, ignoring separators inside quotes', () => {
    expect(detectDelimiter('Nome;Cidade;Valor\nAna;SP;1,5')).toBe(';');
    expect(detectDelimiter('a\tb\tc\n1\t2\t3')).toBe('\t');
    expect(detectDelimiter('"a;b",c,d\n1,2,3')).toBe(',');
    expect(parseCsv('Nome;Valor\nAna;1,5').rows).toEqual([
      ['Nome', 'Valor'],
      ['Ana', '1,5'],
    ]);
  });

  it('reports a quote that never closes', () => {
    expect(parseCsv('a,b\n1,"oops').unterminatedQuote).toBe(true);
    expect(parseCsv('a,b\n1,2').unterminatedQuote).toBe(false);
  });
});

describe('decodeCsvBytes', () => {
  it('reads UTF-8 as-is', () => {
    const result = decodeCsvBytes(new TextEncoder().encode('Ação,Vídeo'));
    expect(result).toMatchObject({ text: 'Ação,Vídeo', encoding: 'utf-8', suspicious: false });
  });

  it('falls back to windows-1252 for an Excel export', () => {
    // "Ação" in windows-1252: A, ç (0xE7), ã (0xE3), o
    const result = decodeCsvBytes(new Uint8Array([0x41, 0xe7, 0xe3, 0x6f]));
    expect(result).toMatchObject({ text: 'Ação', encoding: 'windows-1252', suspicious: false });
  });
});
