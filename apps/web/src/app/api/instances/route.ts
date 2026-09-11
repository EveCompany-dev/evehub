import { prisma } from '@eve/core';
import { strings } from '@eve/ui';
import { z } from 'zod';
import { listConnectors, requireConnector } from '../../../connectors';
import { fail, handle, ok } from '../../../lib/api';
import { canCreateInstance } from '../../../lib/permissions';
import { HttpError, requireUser } from '../../../lib/session';

export const runtime = 'nodejs';

const createSchema = z.object({
  connectorId: z.string().min(1),
  label: z.string().min(1).max(80),
  config: z.unknown().optional(),
});

/** Instances in the caller's workspace, plus the catalogue of what can be added. */
export async function GET(): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();

    const instances = await prisma.connectorInstance.findMany({
      where: { workspaceId: user.workspaceId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        connectorId: true,
        label: true,
        status: true,
        statusMessage: true,
        lastSyncedAt: true,
      },
    });

    const available = listConnectors().map((connector) => ({
      id: connector.id,
      label: connector.label,
      description: connector.description ?? null,
      auth: connector.auth,
      capabilities: connector.capabilities,
      defaultSize: connector.defaultSize ?? { w: 6, h: 6 },
      /** Whether this user is allowed to create one. */
      canCreate: canCreateInstance(user, connector.auth),
    }));

    return ok({ instances, available });
  });
}

export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();

    const body = createSchema.safeParse(await request.json());
    if (!body.success) return fail(400, strings.errors.invalidPayload);

    const connector = requireConnector(body.data.connectorId);

    if (!canCreateInstance(user, connector.auth)) {
      throw new HttpError(403, strings.errors.notOwner);
    }

    const config = connector.configSchema.safeParse(body.data.config ?? connector.defaultConfig);
    if (!config.success) {
      return fail(400, `Configuracao invalida: ${config.error.issues.map((i) => i.message).join('; ')}`);
    }

    const instance = await prisma.connectorInstance.create({
      data: {
        workspaceId: user.workspaceId,
        connectorId: connector.id,
        label: body.data.label,
        config: config.data as object,
      },
      select: { id: true, connectorId: true, label: true, status: true, lastSyncedAt: true },
    });

    return ok({ instance }, 201);
  });
}
