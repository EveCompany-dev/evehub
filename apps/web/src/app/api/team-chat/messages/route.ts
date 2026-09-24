import { prisma } from '@eve/core';
import { strings } from '@eve/ui';
import { z } from 'zod';
import { logActivity, quoted } from '../../../../lib/activity';
import { fail, handle, ok } from '../../../../lib/api';
import { notify } from '../../../../lib/notifications';
import { TEAM_MESSAGE_INCLUDE } from '../../../../lib/team-chat';
import { requireUser } from '../../../../lib/session';
import { UPLOAD_URL_PATTERN } from '../../../../lib/uploads';

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
  mentionedUserIds: z.array(z.string().min(1)).max(50).default([]),
});

/** Last 200 messages, oldest first — the workspace's one shared chat, no channels. */
export async function GET(): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();
    const messages = await prisma.teamMessage.findMany({
      where: { workspaceId: user.workspaceId },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: TEAM_MESSAGE_INCLUDE,
    });
    return ok({ messages: messages.reverse() });
  });
}

export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();

    const body = createSchema.safeParse(await request.json());
    if (!body.success) return fail(400, strings.errors.invalidPayload);

    const mentionedUserIds = [...new Set(body.data.mentionedUserIds)];
    if (mentionedUserIds.length > 0) {
      const validCount = await prisma.user.count({ where: { id: { in: mentionedUserIds }, workspaceId: user.workspaceId } });
      if (validCount !== mentionedUserIds.length) return fail(400, 'Uma ou mais menções não pertencem a este workspace.');
    }

    const message = await prisma.teamMessage.create({
      data: {
        workspaceId: user.workspaceId,
        authorId: user.id,
        body: body.data.body,
        attachments: { create: body.data.attachments },
        mentions: { create: mentionedUserIds.map((userId) => ({ userId })) },
      },
      include: TEAM_MESSAGE_INCLUDE,
    });

    await Promise.all(
      mentionedUserIds.map((userId) =>
        notify({
          workspaceId: user.workspaceId,
          userId,
          actorId: user.id,
          type: 'teamMessageMention',
          message: `${message.author.name?.trim() || message.author.email} mencionou você no chat da equipe.`,
        }),
      ),
    );

    // The team chat is the whole team's channel (unlike DMs, never logged).
    const extras = [
      message.attachments.length > 0 ? `${message.attachments.length} anexo(s)` : null,
      mentionedUserIds.length > 0 ? `${mentionedUserIds.length} menção(ões)` : null,
    ].filter(Boolean);
    await logActivity(user, {
      action: 'chat.message',
      summary: `escreveu no chat da equipe: ${quoted(message.body, 140)}${extras.length > 0 ? ` (${extras.join(', ')})` : ''}`,
      entityType: 'teamMessage',
      entityId: message.id,
    });

    return ok({ message }, 201);
  });
}
