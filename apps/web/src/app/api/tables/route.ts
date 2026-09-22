import { prisma } from '@eve/core';
import { strings } from '@eve/ui';
import { z } from 'zod';
import { logActivity, quoted } from '../../../lib/activity';
import { fail, handle, ok } from '../../../lib/api';
import { requireUser } from '../../../lib/session';

export const runtime = 'nodejs';

const createSchema = z.object({ name: z.string().trim().min(1).max(120) });

/** Every local table in the workspace — open to any authenticated member, no permission tag. */
export async function GET(): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();

    const tables = await prisma.dataTable.findMany({
      where: { workspaceId: user.workspaceId },
      orderBy: { createdAt: 'asc' },
      select: { id: true, name: true, columns: true, webhookToken: true, webhookKeyColumn: true },
    });

    return ok({ tables });
  });
}

/** Creates a table with one default text column so it's never empty of columns. */
export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();

    const body = createSchema.safeParse(await request.json());
    if (!body.success) return fail(400, strings.errors.invalidPayload);

    const table = await prisma.dataTable.create({
      data: {
        workspaceId: user.workspaceId,
        name: body.data.name,
        columns: [{ key: 'nome', label: 'Nome', type: 'text' }],
      },
      select: { id: true, name: true, columns: true, webhookToken: true, webhookKeyColumn: true },
    });

    await logActivity(user, { action: 'table.create', summary: `criou a tabela ${quoted(table.name)}`, entityType: 'table', entityId: table.id });

    return ok({ table }, 201);
  });
}
