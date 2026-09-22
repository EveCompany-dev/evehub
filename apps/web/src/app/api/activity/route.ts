import { Prisma, prisma } from '@eve/core';
import { handle, ok } from '../../../lib/api';
import { ACTIVITY_AREAS } from '../../../lib/activity-areas';
import { canViewActivityLog } from '../../../lib/permissions';
import { HttpError, requireUser } from '../../../lib/session';

export const runtime = 'nodejs';

const PAGE_SIZE = 100;

function parseDay(value: string | null, endOfDay: boolean): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  // Dia no fuso de Sao Paulo (-03:00, sem horario de verao desde 2019), que e
  // o fuso de quem usa o filtro — senao "hoje" cortaria as 21h.
  const date = new Date(`${value}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}-03:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * O registro de atividades, mais novo primeiro, em paginas de 100. Somente
 * admin. Filtros: area (prefixo da acao), pessoa, periodo e texto livre.
 * `cursor` e o id da ultima linha da pagina anterior.
 */
export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();
    if (!canViewActivityLog(user)) throw new HttpError(403, 'Só os administradores veem o registro de atividades.');

    const params = new URL(request.url).searchParams;
    const cursor = params.get('cursor');
    const area = ACTIVITY_AREAS.find((row) => row.key === params.get('area'));
    const actorId = params.get('actorId');
    const q = params.get('q')?.trim().slice(0, 200);
    const from = parseDay(params.get('from'), false);
    const to = parseDay(params.get('to'), true);

    const where: Prisma.ActivityLogWhereInput = {
      workspaceId: user.workspaceId,
      ...(area ? { OR: area.prefixes.map((prefix) => ({ action: { startsWith: prefix } })) } : {}),
      ...(actorId ? { actorId } : {}),
      ...(from || to ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
      ...(q
        ? {
            AND: [
              {
                OR: [
                  { summary: { contains: q, mode: 'insensitive' as const } },
                  { actorLabel: { contains: q, mode: 'insensitive' as const } },
                ],
              },
            ],
          }
        : {}),
    };

    const rows = await prisma.activityLog.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: PAGE_SIZE + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        actorId: true,
        actorLabel: true,
        action: true,
        entityType: true,
        entityId: true,
        summary: true,
        createdAt: true,
        actor: { select: { image: true, deletedAt: true } },
      },
    });

    const page = rows.slice(0, PAGE_SIZE);

    // A lista de pessoas do filtro so vai na primeira pagina — inclui quem ja
    // foi apagado, que continua tendo historico.
    const actors = cursor
      ? undefined
      : await prisma.user.findMany({
          where: { workspaceId: user.workspaceId, activityLogs: { some: {} } },
          orderBy: { name: 'asc' },
          select: { id: true, name: true, email: true, deletedAt: true },
        });

    return ok({
      entries: page.map((row) => ({
        id: row.id,
        actorId: row.actorId,
        actorLabel: row.actorLabel,
        actorImage: row.actor?.image ?? null,
        actorRemoved: Boolean(row.actor?.deletedAt),
        action: row.action,
        entityType: row.entityType,
        entityId: row.entityId,
        summary: row.summary,
        createdAt: row.createdAt.toISOString(),
      })),
      nextCursor: rows.length > PAGE_SIZE ? (page[page.length - 1]?.id ?? null) : null,
      ...(actors
        ? {
            actors: actors.map((row) => ({
              id: row.id,
              label: row.deletedAt ? (row.name ?? 'Conta removida') : row.name?.trim() || row.email,
            })),
          }
        : {}),
    });
  });
}
