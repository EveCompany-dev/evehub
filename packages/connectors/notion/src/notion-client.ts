/**
 * Cliente HTTP minimo do Notion.
 *
 * Sem @notionhq/client de proposito: precisamos de tres endpoints e o SDK
 * traria uma dependencia a mais para versionar junto com a versao da API. Com
 * `fetch` nativo, a unica coisa a acompanhar e o header Notion-Version.
 */

/** Versao fixada. Subir isso e uma decisao consciente, nunca um efeito colateral. */
export const NOTION_VERSION = '2026-03-11';

const BASE_URL = 'https://api.notion.com/v1';
const TIMEOUT_MS = 15_000;

export class NotionError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'NotionError';
  }
}

interface NotionErrorBody {
  code?: string;
  message?: string;
}

/**
 * Traduz o erro do Notion para algo acionavel.
 *
 * `object_not_found` merece atencao especial: quase sempre nao e um ID errado,
 * e sim a integracao que nao foi compartilhada com a database — o tropeco mais
 * comum de quem conecta o Notion pela primeira vez.
 */
function describeError(status: number, body: NotionErrorBody): string {
  switch (body.code) {
    case 'unauthorized':
      return 'Token do Notion invalido ou revogado.';
    case 'restricted_resource':
    case 'object_not_found':
      return 'O Notion não encontrou essa database. Quase sempre é porque a integração não foi compartilhada com ela: abra a página no Notion, menu "..." > Conexões > adicione a integração.';
    case 'rate_limited':
      return 'O Notion limitou a taxa de requisições. A próxima sincronização tenta de novo.';
    case 'validation_error':
      return `O Notion recusou a requisicao: ${body.message ?? 'dados invalidos'}`;
    default:
      return body.message ?? `Notion respondeu HTTP ${status}.`;
  }
}

export async function notionRequest<T>(
  token: string,
  path: string,
  init: { method?: 'GET' | 'POST' | 'PATCH'; body?: unknown } = {},
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(`${BASE_URL}${path}`, {
      method: init.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'Notion-Version': NOTION_VERSION,
        'Content-Type': 'application/json',
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: controller.signal,
    });

    const raw = await response.text();
    const parsed = raw ? (JSON.parse(raw) as unknown) : {};

    if (!response.ok) {
      const body = parsed as NotionErrorBody;
      throw new NotionError(describeError(response.status, body), response.status, body.code);
    }

    return parsed as T;
  } catch (error) {
    if (error instanceof NotionError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      throw new NotionError('O Notion não respondeu a tempo.', 504, 'timeout');
    }
    throw new NotionError(error instanceof Error ? error.message : String(error), 0);
  } finally {
    clearTimeout(timer);
  }
}

export interface NotionDataSourceRef {
  id: string;
  name: string;
}

interface DatabaseResponse {
  title?: { plain_text?: string }[];
  data_sources?: NotionDataSourceRef[];
}

/**
 * Resolve a data source a partir do ID da database.
 *
 * Desde a versao 2025-09-03 da API uma database contem uma ou mais data
 * sources, e as queries acontecem na data source. Pedimos o ID da database ao
 * usuario (que e o que da para copiar da URL) e resolvemos o resto aqui.
 */
export async function resolveDataSource(
  token: string,
  databaseId: string,
): Promise<{ dataSourceId: string; title: string }> {
  const database = await notionRequest<DatabaseResponse>(token, `/databases/${databaseId}`);

  const first = database.data_sources?.[0];
  if (!first) {
    throw new NotionError('Essa database não expõe nenhuma data source.', 404, 'no_data_source');
  }

  const title = database.title?.map((piece) => piece.plain_text ?? '').join('') || 'Notion';
  return { dataSourceId: first.id, title };
}
