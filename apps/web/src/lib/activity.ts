import { errorMessage, Prisma, prisma } from '@eve/core';

/** Quem fez. A SessionUser ja tem esse formato; o login (sem sessao ainda) monta um na mao. */
export interface ActivityActor {
  id: string;
  name: string | null;
  email: string;
  workspaceId: string;
}

export interface ActivityEntry {
  /** "area.verbo" — ver lib/activity-areas.ts. */
  action: string;
  /** Frase em pt-BR sem o autor: "criou o job “Post de lancamento”". */
  summary: string;
  entityType?: string;
  entityId?: string;
  details?: Record<string, unknown>;
}

/**
 * Grava uma linha no registro de atividades que os admins leem.
 *
 * O que entra: tudo o que alguem faz e que o resto do time ve ou sente —
 * jobs, tabelas, clientes, financeiro, agenda, conectores, chat da equipe, a
 * propria equipe, senhas. O que nunca entra: conversa privada (DirectMessage),
 * o chat de IA do widget, e preferencia pessoal (layout da dashboard, tema,
 * notificacao lida). Quem instrumenta uma rota nova decide por essa regra.
 *
 * Nunca lanca: o registro e uma testemunha, nao uma trava. Um insert que
 * falha vira log de servidor e a acao do usuario segue — perder uma linha de
 * auditoria e melhor do que perder o job que a pessoa acabou de salvar.
 */
export async function logActivity(actor: ActivityActor, entry: ActivityEntry): Promise<void> {
  await writeActivity(actor.workspaceId, actor.id, actorLabel(actor), entry);
}

/**
 * Para o que acontece sem sessao, como o pedido de "esqueci minha senha": o
 * autor e a conta que pediu (ou ninguem), mas o workspace vem do banco.
 */
export async function logAnonymousActivity(
  workspaceId: string,
  actor: { id: string; name: string | null; email: string } | null,
  entry: ActivityEntry,
): Promise<void> {
  await writeActivity(workspaceId, actor?.id ?? null, actor ? actorLabel(actor) : 'Visitante', entry);
}

async function writeActivity(workspaceId: string, actorId: string | null, label: string, entry: ActivityEntry): Promise<void> {
  try {
    await prisma.activityLog.create({
      data: {
        workspaceId,
        actorId,
        actorLabel: label.slice(0, 200),
        action: entry.action,
        summary: entry.summary.slice(0, 1000),
        entityType: entry.entityType ?? null,
        entityId: entry.entityId ?? null,
        ...(entry.details ? { details: entry.details as Prisma.InputJsonValue } : {}),
      },
    });
  } catch (error) {
    console.error(`[activity] falha ao registrar ${entry.action}:`, errorMessage(error));
  }
}

function actorLabel(actor: { name: string | null; email: string }): string {
  return actor.name?.trim() || actor.email;
}

/**
 * Um titulo entre aspas, cortado — o registro e uma lista de uma linha por
 * acao, e um titulo de 4 mil caracteres nao cabe nela.
 */
export function quoted(text: string | null | undefined, max = 80): string {
  const clean = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!clean) return '(sem título)';
  return `“${clean.length > max ? `${clean.slice(0, max - 1)}…` : clean}”`;
}

const PLATFORM_LABEL: Record<string, string> = { instagram: 'Instagram', facebook: 'Facebook' };
const TYPE_LABEL: Record<string, string> = { feed: 'feed', story: 'story', reel: 'reel' };

/** "Instagram reel de “Cliente”" — how the log names a scheduled post. */
export function postLabel(post: { platform: string; postType: string; clientLabel: string }): string {
  return `${PLATFORM_LABEL[post.platform] ?? post.platform} ${TYPE_LABEL[post.postType] ?? post.postType} de ${quoted(post.clientLabel)}`;
}

interface ColumnLike {
  key: string;
  label: string;
  type: string;
}

function columnsOf(columns: unknown): ColumnLike[] {
  if (!Array.isArray(columns)) return [];
  return columns.filter(
    (column): column is ColumnLike =>
      Boolean(column) && typeof column === 'object' && typeof (column as ColumnLike).key === 'string' && typeof (column as ColumnLike).label === 'string',
  );
}

/**
 * Como uma linha de tabela aparece no registro: o texto da coluna-titulo
 * (a mesma regra de titleColumn em lib/table-views.ts) e os rotulos das
 * colunas tocadas — nunca os valores, que podem ser um roteiro inteiro.
 */
export function describeRow(
  columnsJson: unknown,
  data: unknown,
  changedKeys: string[] = [],
): { title: string; fields: string } {
  const columns = columnsOf(columnsJson);
  const titleColumn = columns.find((column) => column.type === 'text') ?? columns.find((column) => column.type !== 'boolean') ?? columns[0];
  const value = titleColumn && data && typeof data === 'object' ? (data as Record<string, unknown>)[titleColumn.key] : undefined;
  const text = Array.isArray(value) ? value.join(', ') : value === null || value === undefined ? '' : String(value);
  const labels = changedKeys.map((key) => columns.find((column) => column.key === key)?.label ?? key);
  return { title: quoted(text.split('\n')[0], 60), fields: labels.join(', ') };
}

/** Data e hora no fuso do time (o servidor roda em UTC). */
export function whenLabel(date: Date, withTime = true): string {
  return date.toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  });
}

/** Nome de uma pessoa para a frase ("adicionou Maria ao job ..."). */
export function personLabel(user: { name: string | null; email: string } | null | undefined): string {
  if (!user) return 'alguém';
  return user.name?.trim() || user.email;
}
