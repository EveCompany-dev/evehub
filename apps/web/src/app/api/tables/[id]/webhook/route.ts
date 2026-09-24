import { randomUUID } from 'node:crypto';
import { prisma } from '@eve/core';
import { strings } from '@eve/ui';
import { logActivity, quoted } from '../../../../../lib/activity';
import { handle, ok } from '../../../../../lib/api';
import { canManageAutomations } from '../../../../../lib/permissions';
import { HttpError, requireUser } from '../../../../../lib/session';

export const runtime = 'nodejs';

async function requireTable(id: string, workspaceId: string) {
  const table = await prisma.dataTable.findUnique({ where: { id } });
  if (!table || table.workspaceId !== workspaceId) throw new HttpError(404, strings.errors.notFound);
  return table;
}

/**
 * Generates (or rotates) the table's webhook token. The old token stops working
 * immediately.
 *
 * Owner-only, on the same reasoning lib/permissions.ts already states for the
 * automations token: this opens a public, unauthenticated ingestion endpoint,
 * which makes it a credential. It was open to every member, so anyone could
 * silently rotate it and break every n8n/Zapier integration the team had
 * pointed at it, with nothing recording who did it.
 */
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();
    if (!canManageAutomations(user)) throw new HttpError(403, strings.errors.notOwnerAutomations);
    const { id } = await context.params;
    await requireTable(id, user.workspaceId);

    const table = await prisma.dataTable.update({ where: { id }, data: { webhookToken: randomUUID() } });
    await logActivity(user, {
      action: 'table.webhook',
      summary: `gerou um novo link de automação para a tabela ${quoted(table.name)}`,
      entityType: 'table',
      entityId: id,
    });
    return ok({ webhookToken: table.webhookToken });
  });
}

/** Disables the webhook. Owner-only, same reasoning as POST above. */
export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();
    if (!canManageAutomations(user)) throw new HttpError(403, strings.errors.notOwnerAutomations);
    const { id } = await context.params;
    const table = await requireTable(id, user.workspaceId);

    await prisma.dataTable.update({ where: { id }, data: { webhookToken: null } });
    await logActivity(user, {
      action: 'table.webhook',
      summary: `desligou o link de automação da tabela ${quoted(table.name)}`,
      entityType: 'table',
      entityId: id,
    });
    return ok({ webhookToken: null });
  });
}
