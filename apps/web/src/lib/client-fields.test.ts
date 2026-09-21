import { describe, expect, it } from 'vitest';
import { clientProfileOut, formatCep, formatCnpj, formatPhone, isValidCnpj, parseClientProfile } from './client-fields';

describe('CNPJ', () => {
  it('validates check digits, formatted or not', () => {
    expect(isValidCnpj('11.222.333/0001-81')).toBe(true);
    expect(isValidCnpj('11222333000181')).toBe(true);
    expect(isValidCnpj('11.222.333/0001-82')).toBe(false);
    expect(isValidCnpj('11111111111111')).toBe(false);
    expect(isValidCnpj('123')).toBe(false);
  });

  it('formats as it is typed', () => {
    expect(formatCnpj('11222333000181')).toBe('11.222.333/0001-81');
    expect(formatCnpj('11.222.333/0001-81')).toBe('11.222.333/0001-81');
  });
});

describe('CEP and phone', () => {
  it('formats', () => {
    expect(formatCep('89010000')).toBe('89010-000');
    expect(formatPhone('47912345678')).toBe('(47) 91234-5678');
    expect(formatPhone('4732221234')).toBe('(47) 3222-1234');
    expect(formatPhone('+55 47 3222 1234 r.5')).toBe('+55 47 3222 1234 r.5');
  });
});

describe('parseClientProfile', () => {
  it('validates and normalizes a full registration', () => {
    const result = parseClientProfile(
      {
        cnpj: '11222333000181',
        legalName: ' Acme Ltda ',
        email: 'contato@acme.com.br',
        phone: '47912345678',
        zip: '89010000',
        state: 'sc',
        startDate: '2026-03-01',
        city: '',
      },
      false,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toMatchObject({
      cnpj: '11.222.333/0001-81',
      legalName: 'Acme Ltda',
      phone: '(47) 91234-5678',
      zip: '89010-000',
      state: 'SC',
      city: null,
      street: null,
    });
    expect(result.data.startDate?.toISOString().slice(0, 10)).toBe('2026-03-01');
  });

  it('rejects bad values with a readable message', () => {
    for (const [body, message] of [
      [{ cnpj: '11222333000182' }, /CNPJ/],
      [{ email: 'nope' }, /E-mail/],
      [{ zip: '123' }, /CEP/],
      [{ state: 'Santa Catarina' }, /UF/],
      [{ startDate: '01/03/2026' }, /Data de início/],
    ] as const) {
      const result = parseClientProfile(body, false);
      expect(result.ok, JSON.stringify(body)).toBe(false);
      if (!result.ok) expect(result.error).toMatch(message);
    }
  });

  it('on a partial update only returns what was sent, and lets a field be cleared', () => {
    const untouched = parseClientProfile({ city: 'Brusque' }, true);
    expect(untouched.ok && Object.keys(untouched.data)).toEqual(['city']);
    const cleared = parseClientProfile({ cnpj: '' }, true);
    expect(cleared.ok && cleared.data).toEqual({ cnpj: null });
  });
});

describe('clientProfileOut', () => {
  it('renders the date as yyyy-mm-dd and missing fields as null', () => {
    const out = clientProfileOut({ startDate: new Date('2026-03-01T00:00:00.000Z'), city: 'Brusque' });
    expect(out.startDate).toBe('2026-03-01');
    expect(out.city).toBe('Brusque');
    expect(out.cnpj).toBeNull();
  });
});
