import { prisma } from '@eve/core';
import { strings } from '@eve/ui';
import { handle, ok } from '../../../../../lib/api';
import { findContentRow } from '../../../../../lib/content-rows';
import { canViewScheduling } from '../../../../../lib/permissions';
import { HttpError, requireUser } from '../../../../../lib/session';

export const runtime = 'nodejs';

/** A Calendário de Conteúdo row and the posts already scheduled from it — what "Agendar post" on a row opens with. */
export async function GET(_request: Request, context: { params: Promise<{ rowId: string }> }): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();
    if (!canViewScheduling(user)) throw new HttpError(403, strings.errors.notAllowedScheduling);

    const { rowId } = await context.params;
    const row = await findContentRow(user.workspaceId, rowId);
    if (!row) throw new HttpError(404, strings.errors.notFound);

    const posts = await prisma.scheduledPost.findMany({ where: { contentRowId: row.id }, orderBy: { scheduledFor: 'asc' } });
    return ok({ row, posts });
  });
}
