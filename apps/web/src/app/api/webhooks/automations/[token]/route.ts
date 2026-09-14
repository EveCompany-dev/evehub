import { prisma, type Prisma } from '@eve/core';
import { strings } from '@eve/ui';
import { z } from 'zod';
import { fail, handle, ok } from '../../../../../lib/api';
import { HttpError } from '../../../../../lib/session';

export const runtime = 'nodejs';

const payloadSchema = z.object({
  source: z.string().trim().min(1).max(120),
  event: z.string().trim().min(1).max(120),
  payload: z.record(z.string(), z.unknown()).default({}),
  ok: z.boolean().default(true),
});

/**
 * Public, unauthenticated ingestion endpoint for n8n (or anything else) to
 * report an automation run — the token IS the credential. Same 404 whether
 * the token is wrong or was never generated, matching the table-webhook
 * endpoint's approach to not leaking which tokens are close to valid.
 */
export async function POST(request: Request, context: { params: Promise<{ token: string }> }): Promise<Response> {
  return handle(async () => {
    const { token } = await context.params;

    const workspace = await prisma.workspace.findUnique({ where: { automationWebhookToken: token } });
    if (!workspace) throw new HttpError(404, strings.errors.notFound);

    const body = payloadSchema.safeParse(await request.json().catch(() => null));
    if (!body.success) return fail(400, 'Corpo inválido: esperado { source, event, payload?, ok? }.');

    const log = await prisma.automationLog.create({
      data: {
        workspaceId: workspace.id,
        source: body.data.source,
        event: body.data.event,
        payload: body.data.payload as Prisma.InputJsonValue,
        ok: body.data.ok,
      },
    });

    return ok({ ok: true, log }, 201);
  });
}
