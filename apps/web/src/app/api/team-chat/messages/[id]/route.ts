import { prisma } from '@eve/core';
import { strings } from '@eve/ui';
import { logActivity, quoted } from '../../../../../lib/activity';
import { fail, handle, ok } from '../../../../../lib/api';
import { HttpError, requireUser } from '../../../../../lib/session';
import { deleteUpload } from '../../../../../lib/uploads';

export const runtime = 'nodejs';

/** Author-only delete, mirroring job comment deletion. Attachment files are cleaned up best-effort. */
export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await context.params;

    const message = await prisma.teamMessage.findUnique({ where: { id }, include: { attachments: true } });
    if (!message || message.workspaceId !== user.workspaceId) throw new HttpError(404, strings.errors.notFound);
    if (message.authorId !== user.id) return fail(403, strings.errors.notCommentAuthor);

    await prisma.teamMessage.delete({ where: { id } });
    await Promise.all(message.attachments.map((attachment) => deleteUpload(attachment.url)));
    await logActivity(user, {
      action: 'chat.delete',
      summary: `apagou uma mensagem própria do chat da equipe: ${quoted(message.body, 140)}`,
      entityType: 'teamMessage',
      entityId: id,
    });

    return ok({ ok: true });
  });
}
