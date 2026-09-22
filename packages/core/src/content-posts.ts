import { prisma, type PostStatus, type Prisma } from './prisma';

/**
 * A Calendário de Conteúdo row and the posts scheduled from it are one thing:
 * the row is the plan, the posts are its execution. Eve Hub moves the row's
 * Status by itself from what actually happened on Meta — the worker only
 * reports "published" after Meta confirms it — so nobody has to remember to
 * flip the tag. Used by the web app (schedule, reschedule, cancel) and by the
 * worker (published, failed).
 */
export const CONTENT_STATUS = {
  scheduled: 'Programado',
  published: 'Publicado',
  failed: 'Falhou',
  /** Where a row goes back to when its last post is cancelled: ready, but not scheduled. */
  unscheduled: 'Em aprovação',
} as const;

/** The statuses only Eve Hub sets. A row showing one of these with no post left is stale. */
const AUTOMATIC: ReadonlySet<string> = new Set([CONTENT_STATUS.scheduled, CONTENT_STATUS.published, CONTENT_STATUS.failed]);

/**
 * The content calendar is a date column, not a timestamp: a post at 22:00 in
 * São Paulo is still that day, even though it is already tomorrow in UTC,
 * where the server runs.
 */
export const CONTENT_TIME_ZONE = 'America/Sao_Paulo';

/** "2026-09-22" for the day `date` falls on in São Paulo. */
export function contentDate(date: Date): string {
  // en-CA formats as YYYY-MM-DD, the table's own date format.
  return new Intl.DateTimeFormat('en-CA', { timeZone: CONTENT_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

export interface ContentPostState {
  status: PostStatus;
  scheduledFor: Date;
  permalink: string | null;
}

/** The row's Status given its posts; null when it has none. A failure wins, then "all out", else scheduled. */
export function contentStatusFor(posts: readonly Pick<ContentPostState, 'status'>[]): string | null {
  if (posts.length === 0) return null;
  if (posts.some((post) => post.status === 'failed')) return CONTENT_STATUS.failed;
  if (posts.every((post) => post.status === 'published')) return CONTENT_STATUS.published;
  return CONTENT_STATUS.scheduled;
}

/**
 * The row's data after catching up with its posts, or null when nothing
 * changes. Only Status, the date and an empty link are touched — the title,
 * script and everything else stay as the team wrote them.
 */
export function contentRowPatch(data: Record<string, unknown>, posts: readonly ContentPostState[]): Record<string, unknown> | null {
  const next: Record<string, unknown> = { ...data };
  const status = contentStatusFor(posts);

  if (status) {
    next.status = status;
    const first = posts.reduce((earliest, post) => (post.scheduledFor < earliest ? post.scheduledFor : earliest), posts[0]!.scheduledFor);
    next.data = contentDate(first);
    const link = posts.find((post) => post.status === 'published' && post.permalink)?.permalink;
    if (link && (typeof data.link !== 'string' || data.link.trim() === '')) next.link = link;
  } else if (typeof data.status === 'string' && AUTOMATIC.has(data.status)) {
    next.status = CONTENT_STATUS.unscheduled;
  }

  const changed = Object.keys(next).some((key) => next[key] !== data[key]);
  return changed ? next : null;
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** Re-reads a content row's posts and writes whatever its Status/date/link should now say. */
export async function refreshContentRow(rowId: string): Promise<void> {
  const row = await prisma.dataTableRow.findUnique({
    where: { id: rowId },
    select: { data: true, scheduledPosts: { select: { status: true, scheduledFor: true, permalink: true } } },
  });
  if (!row) return;

  const patch = contentRowPatch(asObject(row.data), row.scheduledPosts);
  if (patch) await prisma.dataTableRow.update({ where: { id: rowId }, data: { data: patch as Prisma.InputJsonValue } });
}
