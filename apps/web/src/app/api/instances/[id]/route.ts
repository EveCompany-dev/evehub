import { encryptJson, prisma } from '@eve/core';
import { strings } from '@eve/ui';
import { z } from 'zod';
import { requireConnector } from '../../../../connectors';
import { fail, handle, ok } from '../../../../lib/api';
import { canDeleteInstance, canWriteCredentials } from '../../../../lib/permissions';
import { HttpError, requireInstance, requireUser } from '../../../../lib/session';

export const runtime = 'nodejs';

const patchSchema = z.object({
  label: z.string().min(1).max(80).optional(),
  config: z.unknown().optional(),
  /** Plaintext secret. Encrypted here and never returned by any endpoint. */
  credentials: z.record(z.string(), z.unknown()).optional(),
});

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await context.params;
    const instance = await requireInstance(id, user);

    const body = patchSchema.safeParse(await request.json());
    if (!body.success) return fail(400, strings.errors.invalidPayload);

    const connector = requireConnector(instance.connectorId);
    const data: Record<string, unknown> = {};

    if (body.data.label) data.label = body.data.label;

    if (body.data.config !== undefined) {
      const config = connector.configSchema.safeParse(body.data.config);
      if (!config.success) {
        return fail(400, `Configuracao invalida: ${config.error.issues.map((i) => i.message).join('; ')}`);
      }
      data.config = config.data as object;
    }

    if (body.data.credentials !== undefined) {
      // The owner gate, enforced on the server. Hiding the form in the UI is
      // not access control.
      if (!canWriteCredentials(user)) throw new HttpError(403, strings.errors.notOwner);

      if (!connector.credentialsSchema) {
        return fail(400, `O connector "${connector.id}" nao aceita credenciais.`);
      }

      const credentials = connector.credentialsSchema.safeParse(body.data.credentials);
      if (!credentials.success) return fail(400, 'Credenciais invalidas para este connector.');

      const encrypted = encryptJson(credentials.data);
      data.credentialsEnc = encrypted.data;
      data.credentialsKeyVersion = encrypted.keyVersion;
    }

    if (Object.keys(data).length === 0) return fail(400, strings.errors.invalidPayload);

    const updated = await prisma.connectorInstance.update({
      where: { id },
      data,
      // credentialsEnc is deliberately absent: a secret never leaves the server.
      select: { id: true, connectorId: true, label: true, status: true, lastSyncedAt: true },
    });

    return ok({ instance: updated });
  });
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await context.params;
    await requireInstance(id, user);

    if (!canDeleteInstance(user)) throw new HttpError(403, strings.errors.notOwner);

    // Cascades to snapshots, records and the edit log.
    await prisma.connectorInstance.delete({ where: { id } });

    return ok({ ok: true });
  });
}
