export type NumberLocale = 'pt' | 'en';

export interface ParsedNumber {
  value: number;
  /** "1.234" / "1,234": readable as thousands or as a decimal, depending on the locale. */
  ambiguous: boolean;
}

const CURRENCY = /^(?:R\$|US\$|\$|€|£)\s*/i;

/**
 * Reads a number the way a spreadsheet export writes it: plain (1234.5),
 * pt-BR (1.234,56) or en (1,234.56), optionally with a currency symbol or a
 * trailing %. Values with leading zeros ("007", "0123") are refused — those
 * are codes (zip, phone, id), not quantities, and importing them as numbers
 * would silently drop the zeros.
 */
export function parseLooseNumber(input: string, locale: NumberLocale = 'pt'): ParsedNumber | null {
  let text = input.trim();
  if (!text) return null;

  text = text.replace(CURRENCY, '').replace(/\s*%$/, '').trim();
  const negative = /^-|^\(.*\)$/.test(text);
  text = text.replace(/^-/, '').replace(/^\((.*)\)$/, '$1').trim();
  if (!text) return null;

  // Digits grouped with spaces (fr/pt style: "1 234,5") behave like a dot group.
  text = text.replace(/(?<=\d)[  ](?=\d{3}(?:\D|$))/g, '');

  if (/^0\d/.test(text) && !/^0[.,]/.test(text)) return null;

  const sign = negative ? -1 : 1;

  if (/^\d+$/.test(text)) return { value: sign * Number(text), ambiguous: false };

  // Both separators present: the last one is the decimal mark.
  if (text.includes('.') && text.includes(',')) {
    const commaDecimal = text.lastIndexOf(',') > text.lastIndexOf('.');
    const valid = commaDecimal ? /^\d{1,3}(\.\d{3})*,\d+$/ : /^\d{1,3}(,\d{3})*\.\d+$/;
    if (!valid.test(text)) return null;
    const normalized = commaDecimal ? text.replace(/\./g, '').replace(',', '.') : text.replace(/,/g, '');
    return { value: sign * Number(normalized), ambiguous: false };
  }

  const separator = text.includes(',') ? ',' : text.includes('.') ? '.' : null;
  if (!separator) return null;

  const parts = text.split(separator);
  if (parts.length > 2) {
    // 1.234.567 / 1,234,567: only ever a thousands grouping.
    if (!parts.every((part, index) => (index === 0 ? /^\d{1,3}$/.test(part) : /^\d{3}$/.test(part)))) return null;
    return { value: sign * Number(parts.join('')), ambiguous: false };
  }

  const [whole, fraction] = parts as [string, string];
  if (!/^\d+$/.test(whole) || !/^\d+$/.test(fraction)) return null;

  const groupLike = /^\d{1,3}$/.test(whole) && fraction.length === 3;
  if (groupLike) {
    // "1.234": thousands in pt (dot) / decimals in en, and vice versa for the comma.
    const isThousands = separator === '.' ? locale === 'pt' : locale === 'en';
    const asThousands = Number(whole + fraction);
    const asDecimal = Number(`${whole}.${fraction}`);
    return { value: sign * (isThousands ? asThousands : asDecimal), ambiguous: true };
  }

  return { value: sign * Number(`${whole}.${fraction}`), ambiguous: false };
}
