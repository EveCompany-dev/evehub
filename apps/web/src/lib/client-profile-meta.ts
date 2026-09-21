/** Client-safe description of the registration fields (no zod, so forms can import it). */

export const PROFILE_KEYS = [
  'legalName',
  'cnpj',
  'stateRegistration',
  'municipalRegistration',
  'email',
  'phone',
  'startDate',
  'zip',
  'street',
  'streetNumber',
  'complement',
  'district',
  'city',
  'state',
  'country',
] as const;

export type ProfileKey = (typeof PROFILE_KEYS)[number];

export type ClientProfile = Record<ProfileKey, string | null>;

export interface ProfileField {
  key: ProfileKey;
  label: string;
  group: 'company' | 'address';
  input: 'text' | 'email' | 'tel' | 'date';
  placeholder?: string;
  maxLength?: number;
  /** Grid span hint for the form (1 = half width, 2 = full row). */
  wide?: boolean;
}

export const PROFILE_FIELDS: ProfileField[] = [
  { key: 'legalName', label: 'Razão Social', group: 'company', input: 'text', wide: true },
  { key: 'cnpj', label: 'CNPJ', group: 'company', input: 'text', placeholder: '00.000.000/0000-00', maxLength: 18 },
  { key: 'stateRegistration', label: 'IE', group: 'company', input: 'text', maxLength: 40 },
  { key: 'municipalRegistration', label: 'IM', group: 'company', input: 'text', maxLength: 40 },
  { key: 'startDate', label: 'Data de início', group: 'company', input: 'date' },
  { key: 'email', label: 'E-mail', group: 'company', input: 'email' },
  { key: 'phone', label: 'Telefone', group: 'company', input: 'tel', placeholder: '(00) 00000-0000' },
  { key: 'zip', label: 'CEP', group: 'address', input: 'text', placeholder: '00000-000', maxLength: 9 },
  { key: 'street', label: 'Endereço', group: 'address', input: 'text', wide: true },
  { key: 'streetNumber', label: 'Número', group: 'address', input: 'text', maxLength: 20 },
  { key: 'complement', label: 'Complemento', group: 'address', input: 'text' },
  { key: 'district', label: 'Bairro', group: 'address', input: 'text' },
  { key: 'city', label: 'Cidade', group: 'address', input: 'text' },
  { key: 'state', label: 'UF', group: 'address', input: 'text', placeholder: 'SC', maxLength: 2 },
  { key: 'country', label: 'País', group: 'address', input: 'text', placeholder: 'Brasil' },
];

export function emptyProfile(): ClientProfile {
  return Object.fromEntries(PROFILE_KEYS.map((key) => [key, null])) as ClientProfile;
}

/** Copies the registration fields out of an API client object (missing ones become null). */
export function pickProfile(source: object): ClientProfile {
  const record = source as Record<string, unknown>;
  return Object.fromEntries(PROFILE_KEYS.map((key) => [key, typeof record[key] === 'string' ? record[key] : null])) as ClientProfile;
}
