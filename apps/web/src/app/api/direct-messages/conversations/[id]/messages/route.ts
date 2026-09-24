import { prisma } from '@eve/core';
import { strings } from '@eve/ui';
import { z } from 'zod';
import { fail, handle, ok } from '../../../../../../lib/api';
import { DIRECT_MESSAGE_INCLUDE } from '../../../../../../lib/direct-chat';
import { HttpError, requireUser } from '../../../../../../lib/session';
import { notify } from '../../../../../../lib/notifications';
import { UPLOAD_URL_PATTERN } from '../../../../../../lib/uploads';

export const runtime = 'nodejs';

const attachmentSchema = z.object({
  filename: z.string().min(1).max(200),
  // Must name a real upload. This value is handed back to deleteUpload when the
  // message is deleted, so a free-form string here is a delete primitive.
  url: z.string().regex(UPLOAD_URL_PATTERN, 'Anexo invalido.'),
  size: z.number().int().nonnegative(),
});

const createSchema = z.object({
  body: z.string().trim().min(1).max(4000),
  attachments: z.array(attachmentSchema).max(10).default([]),
});

/** Only the two participants may ever touch a conversation — this is the one check every route below needs. */
async function requireParticipant(conversationId: string, userId: string) {
  const conversation = await prisma.directConversation.findUnique({ where: { id: conversationId } });
  if (!conversation || (conversation.userAId !== userId && conversation.userBId !== userId)) {
    throw new HttpError(404, strings.errors.notFound);
  }
  return conversation;
}

/** Last 200 messages of one conversation, oldest first. */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await context.params;
    await requireParticipant(id, user.id);

    const messages = await prisma.directMessage.findMany({
      where: { conversationId: id },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: DIRECT_MESSAGE_INCLUDE,
    });
    return ok({ messages: messages.reverse() });
  });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await context.params;
    const conversation = await requireParticipant(id, user.id);

    const body = createSchema.safeParse(await request.json());
    if (!body.success) return fail(400, strings.errors.invalidPayload);

    // The history stays readable, but a disabled or removed account can't
    // receive anything new — nobody would ever read it.
    const recipientId = conversation.userAId === user.id ? conversation.userBId : conversation.userAId;
    const recipient = await prisma.user.findUnique({ where: { id: recipientId }, select: { disabledAt: true } });
    if (!recipient || recipient.disabledAt) return fail(409, 'Esta pessoa não tem mais acesso ao Eve Hub.');

    const message = await prisma.directMessage.create({
      data: {
        conversationId: id,
        authorId: user.id,
        body: body.data.body,
        attachments: { create: body.data.attachments },
      },
      include: DIRECT_MESSAGE_INCLUDE,
    });

    await notify({
      workspaceId: user.workspaceId,
      userId: recipientId,
      actorId: user.id,
      type: 'directMessage',
      message: `${message.author.name?.trim() || message.author.email} te enviou uma mensagem privada.`,
    });

    return ok({ message }, 201);
  });
}
