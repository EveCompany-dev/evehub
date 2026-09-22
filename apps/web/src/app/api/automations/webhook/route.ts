import { randomUUID } from 'node:crypto';
import { prisma } from '@eve/core';
import { strings } from '@eve/ui';
import { logActivity } from '../../../../lib/activity';
import { handle, ok } from '../../../../lib/api';
import { canManageAutomations } from '../../../../lib/permissions';
import { HttpError, requireUser, type SessionUser } from '../../../../lib/session';

export const runtime = 'nodejs';

async function requireOwnerWorkspace(): Promise<SessionUser> {
  const user = await requireUser();
  const row = await prisma.user.findUnique({ where: { id: user.id }, select: { isOwner: true } });
  if (!row || !canManageAutomations(row)) throw new HttpError(403, strings.errors.notOwnerAutomations);
  return user;
}

/** Current webhook token (null if never generated). Owner-only: the token is a credential. */
export async function GET(): Promise<Response> {
  return handle(async () => {
    const user = await requireOwnerWorkspace();
    const workspace = await prisma.workspace.findUnique({ where: { id: user.workspaceId }, select: { automationWebhookToken: true } });
    return ok({ webhookToken: workspace?.automationWebhookToken ?? null });
  });
}

/** Generates (or rotates) the workspace's automation ingestion token. The old token stops working immediately. */
export async function POST(): Promise<Response> {
  return handle(async () => {
    const user = await requireOwnerWorkspace();
    const workspace = await prisma.workspace.update({
      where: { id: user.workspaceId },
      data: { automationWebhookToken: randomUUID() },
    });
    await logActivity(user, { action: 'automation.token', summary: 'gerou um novo link de automações (o anterior parou de funcionar)' });
    return ok({ webhookToken: workspace.automationWebhookToken });
  });
}

/** Disables the webhook. */
export async function DELETE(): Promise<Response> {
  return handle(async () => {
    const user = await requireOwnerWorkspace();
    await prisma.workspace.update({ where: { id: user.workspaceId }, data: { automationWebhookToken: null } });
    await logActivity(user, { action: 'automation.token', summary: 'desligou o link de automações' });
    return ok({ webhookToken: null });
  });
}
