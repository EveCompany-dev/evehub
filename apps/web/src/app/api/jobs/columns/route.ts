import { prisma } from '@eve/core';
import { strings } from '@eve/ui';
import { z } from 'zod';
import { fail, handle, ok } from '../../../../lib/api';
import { isUniqueConstraintError } from '../../../../lib/jobs';
import { requireUser } from '../../../../lib/session';

export const runtime = 'nodejs';

const createSchema = z.object({ name: z.string().trim().min(1).max(60) });
const reorderSchema = z.object({ order: z.array(z.string().min(1)).min(1) });

export async function GET(): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();
    const columns = await prisma.jobColumn.findMany({
      where: { workspaceId: user.workspaceId },
      orderBy: { position: 'asc' },
    });
    return ok({ columns });
  });
}

export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();

    const body = createSchema.safeParse(await request.json());
    if (!body.success) return fail(400, strings.errors.invalidPayload);

    const columns = await prisma.jobColumn.findMany({ where: { workspaceId: user.workspaceId } });
    const nextPosition = columns.reduce((max, column) => Math.max(max, column.position + 1), 0);

    try {
      const column = await prisma.jobColumn.create({
        data: { workspaceId: user.workspaceId, name: body.data.name, position: nextPosition },
      });
      return ok({ column }, 201);
    } catch (error) {
      if (isUniqueConstraintError(error)) return fail(409, 'Ja existe uma coluna com esse nome.');
      throw error;
    }
  });
}

/** Reorders every column in one shot — the client sends the whole new order, not a delta. */
export async function PATCH(request: Request): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();

    const body = reorderSchema.safeParse(await request.json());
    if (!body.success) return fail(400, strings.errors.invalidPayload);

    const existing = await prisma.jobColumn.findMany({ where: { workspaceId: user.workspaceId }, select: { id: true } });
    const existingIds = new Set(existing.map((column) => column.id));

    if (body.data.order.length !== existingIds.size || body.data.order.some((id) => !existingIds.has(id))) {
      return fail(400, 'A lista de ordem precisa conter exatamente as colunas atuais do workspace.');
    }

    await prisma.$transaction(
      body.data.order.map((id, position) => prisma.jobColumn.update({ where: { id }, data: { position } })),
    );

    const columns = await prisma.jobColumn.findMany({ where: { workspaceId: user.workspaceId }, orderBy: { position: 'asc' } });
    return ok({ columns });
  });
}
