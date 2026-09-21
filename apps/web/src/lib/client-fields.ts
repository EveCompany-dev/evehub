import { z } from 'zod';
import { PROFILE_KEYS } from './client-profile-meta';

/**
 * Cadastro do cliente: the registration fields beyond name/brand. Shared by
 * the create and edit endpoints so both validate and format identically.
 * Everything is optional; an empty string means "not filled in" (stored null).
 */

const digits = (value: string): string => value.replace(/\D/g, '');

/** Real CNPJ check digits — catches a mistyped number, not just a wrong length. */
export function isValidCnpj(value: string): boolean {
  const d = digits(value);
  if (d.length !== 14 || /^(\d)\1+$/.test(d)) return false;
  const check = (length: number): number => {
    const weights = length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const sum = weights.reduce((total, weight, index) => total + weight * Number(d[index]), 0);
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  return check(12) === Number(d[12]) && check(13) === Number(d[13]);
}

export function formatCnpj(value: string): string {
  const d = digits(value).slice(0, 14);
  return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{0,2}).*/, (_, a, b, c, e, f) => `${a}.${b}.${c}/${e}${f ? `-${f}` : ''}`);
}

export function formatCep(value: string): string {
  const d = digits(value).slice(0, 8);
  return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
}

/** (11) 91234-5678 / (11) 1234-5678; anything that isn't 10-11 digits is kept as typed (e.g. +55, extensions). */
export function formatPhone(value: string): string {
  const d = digits(value);
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return value.trim();
}

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => (value ? value : null));

export const clientProfileSchema = z.object({
  cnpj: z
    .string()
    .trim()
    .nullish()
    .refine((value) => !value || isValidCnpj(value), 'CNPJ inválido.')
    .transform((value) => (value ? formatCnpj(value) : null)),
  legalName: optionalText(200),
  stateRegistration: optionalText(40),
  municipalRegistration: optionalText(40),
  email: z
    .string()
    .trim()
    .max(200)
    .nullish()
    .refine((value) => !value || z.email().safeParse(value).success, 'E-mail inválido.')
    .transform((value) => (value ? value : null)),
  phone: z
    .string()
    .trim()
    .max(40)
    .nullish()
    .transform((value) => (value ? formatPhone(value) : null)),
  zip: z
    .string()
    .trim()
    .nullish()
    .refine((value) => !value || digits(value).length === 8, 'CEP deve ter 8 dígitos.')
    .transform((value) => (value ? formatCep(value) : null)),
  street: optionalText(200),
  streetNumber: optionalText(20),
  complement: optionalText(120),
  district: optionalText(120),
  state: z
    .string()
    .trim()
    .nullish()
    .refine((value) => !value || /^[A-Za-z]{2}$/.test(value), 'UF deve ter 2 letras.')
    .transform((value) => (value ? value.toUpperCase() : null)),
  city: optionalText(120),
  country: optionalText(80),
  startDate: z
    .string()
    .nullish()
    .refine((value) => !value || /^\d{4}-\d{2}-\d{2}$/.test(value), 'Data de início inválida.')
    .transform((value) => (value ? new Date(`${value}T00:00:00.000Z`) : null)),
});

export type ClientProfileInput = z.input<typeof clientProfileSchema>;

export const CLIENT_PROFILE_KEYS = PROFILE_KEYS;

export type ClientProfileData = z.output<typeof clientProfileSchema>;

/**
 * Validates the registration fields of a request body. With `partial` (PATCH),
 * only the keys actually sent are returned, so an edit that touches the logo
 * never wipes the CNPJ; without it (POST), every field is returned (null when empty).
 */
export function parseClientProfile(
  raw: unknown,
  partial: boolean,
): { ok: true; data: Partial<ClientProfileData> } | { ok: false; error: string } {
  const body = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const parsed = clientProfileSchema.safeParse(body);
  if (!parsed.success) return { ok: false, error: parsed.error.issues.map((issue) => issue.message).join(' ') };
  const data: Partial<ClientProfileData> = {};
  for (const key of CLIENT_PROFILE_KEYS) {
    if (partial && !(key in body)) continue;
    (data as Record<string, unknown>)[key] = parsed.data[key];
  }
  return { ok: true, data };
}

/** The registration fields of a stored client, as the API and forms carry them (startDate as yyyy-mm-dd). */
export function clientProfileOut(client: { startDate: Date | null } & Record<string, unknown>): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const key of CLIENT_PROFILE_KEYS) out[key] = (client[key] as string | null) ?? null;
  out.startDate = client.startDate ? client.startDate.toISOString().slice(0, 10) : null;
  return out;
}
