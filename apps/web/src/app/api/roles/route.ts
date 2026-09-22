import { prisma } from '@eve/core';
import { strings } from '@eve/ui';
import { z } from 'zod';
import { logActivity, quoted } from '../../../lib/activity';
import { fail, handle, ok } from '../../../lib/api';
import { canManageTeam, ROLE_GRANTABLE_TABS } from '../../../lib/permissions';
import { HttpError, requireUser } from '../../../lib/session';

export const runtime = 'nodejs';

const createSchema = z.object({
  name: z.string().trim().min(1).max(60),
  tabs: z.array(z.string()).default([]),
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


/** Every Role in the workspace, for the roles-management panel and the per-member assignment dropdown. Owner-only, same as the rest of team management. */
export async function GET(): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();
    if (!canManageTeam(user)) throw new HttpError(403, strings.errors.notOwnerTeam);

    const roles = await prisma.role.findMany({ where: { workspaceId: user.workspaceId }, orderBy: { name: 'asc' } });
    return ok({ roles });
  });
}

export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();
    if (!canManageTeam(user)) throw new HttpError(403, strings.errors.notOwnerTeam);

    const body = createSchema.safeParse(await request.json());
    if (!body.success) return fail(400, body.error.issues.map((issue) => issue.message).join('; '));

    const existing = await prisma.role.findFirst({ where: { workspaceId: user.workspaceId, name: body.data.name } });
    if (existing) return fail(409, 'Já existe um cargo com esse nome.');

    const role = await prisma.role.create({
      data: { workspaceId: user.workspaceId, name: body.data.name, tabs: cleanTabs(body.data.tabs) },
    });

    await logActivity(user, {
      action: 'role.create',
      summary: `criou o cargo ${quoted(role.name)} (${tabList(role.tabs)})`,
      entityType: 'role',
      entityId: role.id,
    });

    return ok({ role }, 201);
  });
}
