/**
 * Client-safe half do connector do Notion: nada de token, nada de rede.
 * O widget importa daqui.
 */

/** Tipos de propriedade que sabemos exibir. */
export const READABLE_TYPES = [
  'title',
  'rich_text',
  'select',
  'status',
  'multi_select',
  'number',
  'checkbox',
  'date',
  'url',
  'email',
  'phone_number',
  'people',
  'relation',
  'formula',
  'rollup',
  'files',
  'created_time',
  'last_edited_time',
  'unique_id',
] as const;

export type NotionPropertyType = (typeof READABLE_TYPES)[number];

/**
 * Tipos que sabemos escrever de volta.
 *
 * Deliberadamente conservador: formula e rollup sao calculados pelo Notion e
 * nao aceitam escrita; multi_select, people e relation precisam de uma UI de
 * multipla selecao que nao existe ainda. Ler tudo, escrever o que da para
 * escrever com seguranca.
 */
export const WRITABLE_TYPES = [
  'title',
  'rich_text',
  'select',
  'status',
  'number',
  'checkbox',
  'date',
  'url',
  'email',
  'phone_number',
] as const;

export type NotionWritableType = (typeof WRITABLE_TYPES)[number];

export function isWritableType(type: string): type is NotionWritableType {
  return (WRITABLE_TYPES as readonly string[]).includes(type);
}

/** Descricao de uma coluna, enviada no snapshot para o widget montar a tabela. */
export interface NotionPropertySchema {
  name: string;
  type: string;
  writable: boolean;
  /** Opcoes de select/status, para renderizar um dropdown em vez de texto livre. */
  options?: string[];
}

export interface NotionSnapshot {
  dataSourceId: string;
  databaseTitle: string;
  properties: NotionPropertySchema[];
  rowCount: number;
  truncated: boolean;
  generatedAt: string;
}

/**
 * Aceita o ID cru ou a URL da pagina do Notion.
 *
 * Ninguem tem o ID na mao — todo mundo copia a URL da barra de enderecos, que
 * e tipo https://www.notion.so/workspace/Clientes-24f1b2...?v=... O ID e o
 * ultimo bloco de 32 hex antes da query string.
 */
export function normalizeDatabaseId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const withoutQuery = trimmed.split('?')[0] ?? trimmed;
  const matches = withoutQuery.match(/[0-9a-fA-F]{32}/g);
  const raw = matches?.[matches.length - 1] ?? withoutQuery.replace(/-/g, '');

  if (!/^[0-9a-fA-F]{32}$/.test(raw)) return null;

  // Formato canonico 8-4-4-4-12.
  return [raw.slice(0, 8), raw.slice(8, 12), raw.slice(12, 16), raw.slice(16, 20), raw.slice(20)]
    .join('-')
    .toLowerCase();
}
