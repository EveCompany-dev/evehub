import { isWritableType } from './shared';

export interface NotionRichText {
  plain_text?: string;
}

export interface NotionPropertyValue {
  type?: string;
  [key: string]: unknown;
}

function plain(rich: unknown): string {
  if (!Array.isArray(rich)) return '';
  return rich.map((piece) => (piece as NotionRichText).plain_text ?? '').join('');
}

function named(value: unknown): string {
  if (!value || typeof value !== 'object') return '';
  return String((value as { name?: string }).name ?? '');
}

/**
 * Converte uma propriedade do Notion no valor simples que a tabela mostra.
 *
 * Tudo vira string, numero ou booleano — o widget nao deve precisar entender o
 * formato do Notion, e o `SyncRecord.data` fica legivel no Prisma Studio.
 */
export function readProperty(property: NotionPropertyValue | undefined): string | number | boolean | null {
  if (!property || typeof property !== 'object') return null;

  switch (property.type) {
    case 'title':
      return plain(property.title);
    case 'rich_text':
      return plain(property.rich_text);
    case 'select':
      return named(property.select);
    case 'status':
      return named(property.status);
    case 'multi_select':
      return Array.isArray(property.multi_select)
        ? property.multi_select.map((option) => named(option)).filter(Boolean).join(', ')
        : '';
    case 'number':
      return typeof property.number === 'number' ? property.number : '';
    case 'checkbox':
      return property.checkbox === true;
    case 'date': {
      const date = property.date as { start?: string; end?: string } | null;
      if (!date?.start) return '';
      return date.end ? `${date.start} → ${date.end}` : date.start;
    }
    case 'url':
    case 'email':
    case 'phone_number':
      return typeof property[property.type] === 'string' ? (property[property.type] as string) : '';
    case 'people':
      return Array.isArray(property.people)
        ? property.people.map((person) => named(person)).filter(Boolean).join(', ')
        : '';
    case 'relation':
      return Array.isArray(property.relation) ? `${property.relation.length} vinculo(s)` : '';
    case 'files':
      return Array.isArray(property.files) ? `${property.files.length} arquivo(s)` : '';
    case 'created_time':
      return typeof property.created_time === 'string' ? property.created_time : '';
    case 'last_edited_time':
      return typeof property.last_edited_time === 'string' ? property.last_edited_time : '';
    case 'unique_id': {
      const unique = property.unique_id as { prefix?: string | null; number?: number } | null;
      if (!unique) return '';
      return unique.prefix ? `${unique.prefix}-${unique.number ?? ''}` : String(unique.number ?? '');
    }
    case 'formula': {
      const formula = property.formula as NotionPropertyValue | null;
      if (!formula) return '';
      // A formula embrulha o valor real num tipo proprio.
      return readProperty({ ...formula, type: formula.type });
    }
    case 'rollup': {
      const rollup = property.rollup as NotionPropertyValue | null;
      if (!rollup) return '';
      if (rollup.type === 'array') return Array.isArray(rollup.array) ? `${rollup.array.length} item(ns)` : '';
      return readProperty({ ...rollup, type: rollup.type });
    }
    default:
      return '';
  }
}

export class UnsupportedPropertyError extends Error {
  constructor(name: string, type: string) {
    super(`A propriedade "${name}" e do tipo "${type}", que este connector ainda nao escreve.`);
    this.name = 'UnsupportedPropertyError';
  }
}

/**
 * Monta o payload de escrita do Notion para uma propriedade.
 *
 * Texto vazio vira `null` de proposito: no Notion isso limpa o campo, enquanto
 * mandar string vazia deixa um valor vazio porem presente.
 */
export function buildPropertyPayload(name: string, type: string, value: unknown): Record<string, unknown> {
  if (!isWritableType(type)) throw new UnsupportedPropertyError(name, type);

  const text = value === null || value === undefined ? '' : String(value);

  switch (type) {
    case 'title':
      return { title: text ? [{ type: 'text', text: { content: text } }] : [] };
    case 'rich_text':
      return { rich_text: text ? [{ type: 'text', text: { content: text } }] : [] };
    case 'select':
      return { select: text ? { name: text } : null };
    case 'status':
      return { status: text ? { name: text } : null };
    case 'number': {
      if (text === '') return { number: null };
      const parsed = Number(text.replace(',', '.'));
      if (Number.isNaN(parsed)) throw new Error(`"${name}" espera um numero.`);
      return { number: parsed };
    }
    case 'checkbox':
      return { checkbox: value === true || value === 'true' };
    case 'date': {
      if (!text) return { date: null };
      // Aceita "YYYY-MM-DD" e ISO completo; o Notion recusa o resto.
      const start = text.split('→')[0]?.trim() ?? text;
      return { date: { start } };
    }
    case 'url':
      return { url: text || null };
    case 'email':
      return { email: text || null };
    case 'phone_number':
      return { phone_number: text || null };
    default:
      throw new UnsupportedPropertyError(name, type);
  }
}

/** Converte todas as propriedades de uma pagina no objeto plano do SyncRecord. */
export function readPageProperties(properties: Record<string, NotionPropertyValue>): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const [name, property] of Object.entries(properties ?? {})) {
    data[name] = readProperty(property);
  }
  return data;
}
