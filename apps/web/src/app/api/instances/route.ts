import { encryptJson, prisma, runSync } from '@eve/core';
import { strings } from '@eve/ui';
import { z } from 'zod';
import { listConnectors, requireConnector } from '../../../connectors';
import { logActivity, quoted } from '../../../lib/activity';
import { fail, handle, ok } from '../../../lib/api';
import { canCreateInstance } from '../../../lib/permissions';
import { HttpError, requireUser } from '../../../lib/session';

export const runtime = 'nodejs';

const createSchema = z.object({
  connectorId: z.string().min(1),
  label: z.string().min(1).max(80),
  /** The client this connection belongs to (created from a client's page). */
  clientId: z.string().min(1).optional(),
  config: z.unknown().optional(),
  /**
   * Segredo em texto puro, cifrado aqui e nunca devolvido por nenhum endpoint.
   * Vem junto na criacao para nao existir instancia orfa sem credencial caso o
   * segundo passo falhasse.
   */
  credentials: z.record(z.string(), z.unknown()).optional(),
});

/** Instances in the caller's workspace, plus the catalogue of what can be added. */
export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();
    // ?clientId= narrows to one client's connections (the client page).
    const clientId = new URL(request.url).searchParams.get('clientId');

    const instances = await prisma.connectorInstance.findMany({
      where: { workspaceId: user.workspaceId, ...(clientId ? { clientId } : {}) },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        connectorId: true,
        label: true,
        clientId: true,
        status: true,
        statusMessage: true,
        lastSyncedAt: true,
      },
    });

    const available = listConnectors().map((connector) => ({
      id: connector.id,
      label: connector.label,
      description: connector.description ?? null,
      category: connector.category,
      auth: connector.auth,
      capabilities: connector.capabilities,
      defaultSize: connector.defaultSize ?? { w: 6, h: 6 },
      /** Whether this user is allowed to create one. */
      canCreate: canCreateInstance(user, connector.auth),
      needsCredentials: connector.auth !== 'none',
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

    if (body.data.clientId) {
      const client = await prisma.client.findUnique({ where: { id: body.data.clientId }, select: { workspaceId: true } });
      if (!client || client.workspaceId !== user.workspaceId) throw new HttpError(404, strings.errors.notFound);
    }

    if (!canCreateInstance(user, connector.auth)) {
      throw new HttpError(403, strings.errors.notOwner);
    }

    const config = connector.configSchema.safeParse(body.data.config ?? connector.defaultConfig);
    if (!config.success) {
      return fail(400, `Configuração inválida: ${config.error.issues.map((i) => i.message).join('; ')}`);
    }

    // Connector que exige credencial precisa receber uma agora: sem isso a
    // instancia nasceria em estado de erro permanente.
    const secret: Record<string, unknown> = {};

    if (connector.credentialsSchema) {
      const parsed = connector.credentialsSchema.safeParse(body.data.credentials ?? {});
      if (!parsed.success) {
        return fail(400, `Credenciais invalidas: ${parsed.error.issues.map((i) => i.message).join('; ')}`);
      }
      const encrypted = encryptJson(parsed.data);
      secret.credentialsEnc = encrypted.data;
      secret.credentialsKeyVersion = encrypted.keyVersion;
    }

    const instance = await prisma.connectorInstance.create({
      data: {
        workspaceId: user.workspaceId,
        connectorId: connector.id,
        label: body.data.label,
        ...(body.data.clientId ? { clientId: body.data.clientId } : {}),
        config: config.data as object,
        ...secret,
      },
      select: { id: true, connectorId: true, label: true, clientId: true, status: true, lastSyncedAt: true },
    });

    // Primeira sincronizacao na hora: e o unico feedback honesto de que o token
    // e o ID estao certos. Se falhar, a instancia ja nasce mostrando o porque.
    const first = await runSync(instance.id);

    await logActivity(user, {
      action: 'connector.create',
      summary: `conectou ${quoted(instance.label)} (${connector.id})${connector.auth !== 'none' ? ' com credenciais' : ''}${first.ok ? '' : ' — a primeira sincronização falhou'}`,
      entityType: 'connectorInstance',
      entityId: instance.id,
    });

    return ok({ instance, firstSync: { ok: first.ok, error: first.error ?? null } }, 201);
  });
}
