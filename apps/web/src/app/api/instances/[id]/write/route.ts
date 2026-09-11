import { performWrite } from '@eve/core';
import { strings } from '@eve/ui';
import { z } from 'zod';
import { fail, handle, ok } from '../../../../../lib/api';
import { requireInstance, requireUser } from '../../../../../lib/session';

export const runtime = 'nodejs';

const writeSchema = z.object({
  remoteId: z.string().min(1),
  field: z.string().min(1).max(120),
  value: z.unknown(),
  expectedVersion: z.string().min(1),
});

/**
 * Writes one field upstream under the optimistic lock.
 *
 * A conflict is a 409 with the current upstream value attached, so the widget
 * can show what changed instead of just refusing.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await context.params;
    await requireInstance(id, user);

    const body = writeSchema.safeParse(await request.json());
    if (!body.success) return fail(400, strings.errors.invalidPayload);

    const result = await performWrite({
      instanceId: id,
      userId: user.id,
      remoteId: body.data.remoteId,
      field: body.data.field,
      value: body.data.value,
      expectedVersion: body.data.expectedVersion,
    });

    if (!result.ok && result.conflict) {
      return ok(
        {
          ok: false,
          conflict: true,
          message: result.message,
          currentVersion: result.currentVersion,
          currentData: result.currentData,
        },
        409,
      );
    }

    if (!result.ok) return fail(400, result.message);

    return ok({ ok: true, editLogId: result.editLogId, newVersion: result.newVersion, data: result.data });
  });
}
