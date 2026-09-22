import { prisma } from '@eve/core';
import { z } from 'zod';
import { fail, handle, ok } from '../../../../lib/api';
import { canonicalPair } from '../../../../lib/direct-chat';
import { JOB_MEMBER_SELECT } from '../../../../lib/jobs';
import { HttpError, requireUser } from '../../../../lib/session';

export const runtime = 'nodejs';

const createSchema = z.object({ userId: z.string().min(1) });

/**
 * One row per conversation this user is in, with the other participant and a
 * one-line preview of the last message — everything the DM sidebar needs
 * without a second round trip per conversation.
 */
export async function GET(): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();

    const conversations = await prisma.directConversation.findMany({
      where: { workspaceId: user.workspaceId, OR: [{ userAId: user.id }, { userBId: user.id }] },
      include: {
        userA: { select: JOB_MEMBER_SELECT },
        userB: { select: JOB_MEMBER_SELECT },
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });

    const rows = conversations
      .map((conversation) => {
        const other = conversation.userAId === user.id ? conversation.userB : conversation.userA;
        const last = conversation.messages[0] ?? null;
        return {
          id: conversation.id,
          otherUser: other,
          lastMessage: last ? { body: last.body, createdAt: last.createdAt } : null,
          // Fresh conversations with no messages yet sort by creation instead —
          // otherwise a just-started chat would jump to the bottom under every
          // conversation that already has history.
          sortAt: last?.createdAt ?? conversation.createdAt,
        };
      })
      .sort((a, b) => b.sortAt.getTime() - a.sortAt.getTime());

    return ok({ conversations: rows });
  });
}

/** Get-or-create the (canonical, unique) conversation between the current user and `userId`. */
export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();

    const body = createSchema.safeParse(await request.json());
    if (!body.success) return fail(400, 'ID de usuário inválido.');
    if (body.data.userId === user.id) return fail(400, 'Não é possível iniciar uma conversa consigo mesmo.');

    // Only active accounts: a disabled or removed colleague can't read anything sent to them.
    const other = await prisma.user.findFirst({
      where: { id: body.data.userId, workspaceId: user.workspaceId, disabledAt: null },
      select: JOB_MEMBER_SELECT,
    });
    if (!other) throw new HttpError(404, 'Usuário não encontrado.');

    const [userAId, userBId] = canonicalPair(user.id, body.data.userId);
    const conversation = await prisma.directConversation.upsert({
      where: { userAId_userBId: { userAId, userBId } },
      create: { workspaceId: user.workspaceId, userAId, userBId },
      update: {},
    });

    return ok({ conversation: { id: conversation.id, otherUser: other, lastMessage: null, sortAt: conversation.createdAt } }, 201);
  });
}
