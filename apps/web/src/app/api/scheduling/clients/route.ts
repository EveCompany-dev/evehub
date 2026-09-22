import { prisma } from '@eve/core';
import { strings } from '@eve/ui';
import { z } from 'zod';
import { logActivity, quoted } from '../../../../lib/activity';
import { fail, handle, ok } from '../../../../lib/api';
import { canViewScheduling } from '../../../../lib/permissions';
import { clientProfileOut, parseClientProfile } from '../../../../lib/client-fields';
import { HttpError, requireUser } from '../../../../lib/session';

export const runtime = 'nodejs';

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  notes: z.string().trim().max(2000).optional(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  icon: z.string().trim().max(8).optional(),
  logoUrl: z.string().max(500).startsWith('/uploads/').optional(),
});

/**
 * Local client list for the scheduling filter/composer (and everywhere else
 * that reuses this endpoint — Data Tables' client column, job description
 * mentions, Financeiro, chat @mentions, project folders). `source: 'local'`
 * stays on every row even though Notion is gone, so those existing
 * `.filter(c => c.source === 'local')` call sites keep working unchanged.
 *
 * Read-only listing is intentionally not scheduling-gated: clients are now a
 * cross-cutting entity (Jobs — a default tab everyone sees — can link a job
 * to a client/project), not just a scheduling concept. Managing the registry
 * itself (create/rename/delete, below and in [id]/route.ts) stays owner of
 * the scheduling team, same as before.
 */
export async function GET(): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();

    const local = await prisma.client.findMany({ where: { workspaceId: user.workspaceId }, orderBy: { name: 'asc' } });

    return ok({
      clients: local.map((client) => ({
        source: 'local' as const,
        id: client.id,
        label: client.name,
        notes: client.notes,
        color: client.color,
        icon: client.icon,
        logoUrl: client.logoUrl,
        ...clientProfileOut(client),
        createdAt: client.createdAt,
      })),
    });
  });
}

/** Creates a local client. */
export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();
    if (!canViewScheduling(user)) throw new HttpError(403, strings.errors.notAllowedScheduling);

    const raw: unknown = await request.json().catch(() => null);
    const body = createSchema.safeParse(raw);
    if (!body.success) return fail(400, strings.errors.invalidPayload);
    const profile = parseClientProfile(raw, false);
    if (!profile.ok) return fail(400, profile.error);

    const client = await prisma.client.create({
      data: {
        workspaceId: user.workspaceId,
        name: body.data.name,
        notes: body.data.notes ?? null,
        color: body.data.color ?? null,
        icon: body.data.icon || null,
        logoUrl: body.data.logoUrl ?? null,
        ...profile.data,
      },
    });

    await logActivity(user, { action: 'client.create', summary: `cadastrou o cliente ${quoted(client.name)}`, entityType: 'client', entityId: client.id });

    return ok({ client: { ...client, ...clientProfileOut(client) } }, 201);
  });
}
