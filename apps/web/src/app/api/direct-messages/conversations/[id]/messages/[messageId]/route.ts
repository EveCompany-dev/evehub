import { prisma } from '@eve/core';
import { strings } from '@eve/ui';
import { fail, handle, ok } from '../../../../../../../lib/api';
import { HttpError, requireUser } from '../../../../../../../lib/session';
import { deleteUpload } from '../../../../../../../lib/uploads';

export const runtime = 'nodejs';

/** Author-only delete, mirroring team-chat's message deletion. Attachment files are cleaned up best-effort. */
export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string; messageId: string }> },
): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();
    const { id, messageId } = await context.params;

    const message = await prisma.directMessage.findUnique({
      where: { id: messageId },
      include: { attachments: true, conversation: true },
    });
    if (!message || message.conversationId !== id) throw new HttpError(404, strings.errors.notFound);
    if (message.conversation.userAId !== user.id && message.conversation.userBId !== user.id) {
      throw new HttpError(404, strings.errors.notFound);
    }
    if (message.authorId !== user.id) return fail(403, strings.errors.notCommentAuthor);

    await prisma.directMessage.delete({ where: { id: messageId } });
    await Promise.all(message.attachments.map((attachment) => deleteUpload(attachment.url)));

    return ok({ ok: true });
  });
}
