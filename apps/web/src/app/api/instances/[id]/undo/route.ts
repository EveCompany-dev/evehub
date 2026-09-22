import { performUndo } from '@eve/core';
import { strings } from '@eve/ui';
import { z } from 'zod';
import { logActivity, quoted } from '../../../../../lib/activity';
import { fail, handle, ok } from '../../../../../lib/api';
import { requireInstance, requireUser } from '../../../../../lib/session';

export const runtime = 'nodejs';

const undoSchema = z.object({ editLogId: z.string().min(1) });

/**
 * Reverts an edit inside the 10-minute window.
 *
 * Goes through the same write path as a normal edit, including the optimistic
 * lock — if somebody changed the record after you, the undo conflicts rather
 * than stomping their change.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await context.params;
    const instance = await requireInstance(id, user);

    const body = undoSchema.safeParse(await request.json());
    if (!body.success) return fail(400, strings.errors.invalidPayload);

    const result = await performUndo({ editLogId: body.data.editLogId, userId: user.id });

    if (!result.ok && result.conflict) {
      return ok({ ok: false, conflict: true, message: result.message }, 409);
    }
    if (!result.ok) return fail(400, result.message);

    await logActivity(user, {
      action: 'connector.undo',
      summary: `desfez uma edição no conector ${quoted(instance.label)}`,
      entityType: 'connectorInstance',
      entityId: id,
    });

    return ok({ ok: true, editLogId: result.editLogId, newVersion: result.newVersion });
  });
}
