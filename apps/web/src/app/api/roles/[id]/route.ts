import { prisma } from '@eve/core';
import { strings } from '@eve/ui';
import { z } from 'zod';
import { logActivity, quoted } from '../../../../lib/activity';
import { fail, handle, ok } from '../../../../lib/api';
import { canManageTeam, ROLE_GRANTABLE_TABS } from '../../../../lib/permissions';
import { HttpError, requireUser } from '../../../../lib/session';

export const runtime = 'nodejs';

const patchSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  tabs: z.array(z.string()).optional(),
});

/** Only what a Role may grant — never the admin-only activity log. */
function cleanTabs(tabs: string[]): string[] {
  return tabs.filter((tab) => (ROLE_GRANTABLE_TABS as readonly string[]).includes(tab));
}

const TAB_LABELS: Record<string, string> = {
  chat: 'Chat',
  jobs: 'Jobs',
  tables: 'Tabelas',
  connectors: 'Conectores',
  automations: 'Automações',
  scheduling: 'Agenda',
  financial: 'Financeiro',
  team: 'Equipe',
};

function tabList(tabs: unknown): string {
  const list = Array.isArray(tabs) ? tabs.map((tab) => TAB_LABELS[String(tab)] ?? String(tab)) : [];
  return list.length > 0 ? list.join(', ') : 'nenhuma aba extra';
}


async function requireRole(id: string, workspaceId: string) {
  const role = await prisma.role.findUnique({ where: { id } });
  if (!role || role.workspaceId !== workspaceId) throw new HttpError(404, strings.errors.notFound);
  return role;
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();
    if (!canManageTeam(user)) throw new HttpError(403, strings.errors.notOwnerTeam);

    const { id } = await context.params;
    const before = await requireRole(id, user.workspaceId);

    const body = patchSchema.safeParse(await request.json());
    if (!body.success) return fail(400, strings.errors.invalidPayload);

    const role = await prisma.role.update({
      where: { id },
      data: {
        ...(body.data.name !== undefined ? { name: body.data.name } : {}),
        ...(body.data.tabs !== undefined ? { tabs: cleanTabs(body.data.tabs) } : {}),
      },
    });

    await logActivity(user, {
      action: 'role.update',
      summary:
        role.name !== before.name
          ? `renomeou o cargo ${quoted(before.name)} para ${quoted(role.name)} (${tabList(role.tabs)})`
          : `mudou as abas do cargo ${quoted(role.name)} para: ${tabList(role.tabs)}`,
      entityType: 'role',
      entityId: id,
    });

    return ok({ role });
  });
}

/** Users with this Role fall back to the default tab set (SetNull), not locked out entirely. */
export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();
    if (!canManageTeam(user)) throw new HttpError(403, strings.errors.notOwnerTeam);

    const { id } = await context.params;
    const role = await requireRole(id, user.workspaceId);

    await prisma.role.delete({ where: { id } });
    await logActivity(user, {
      action: 'role.delete',
      summary: `apagou o cargo ${quoted(role.name)} (quem tinha ficou só com as abas padrão)`,
      entityType: 'role',
      entityId: id,
    });
    return ok({ ok: true });
  });
}
