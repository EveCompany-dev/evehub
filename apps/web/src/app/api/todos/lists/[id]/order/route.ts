import { strings } from '@eve/ui';
import { z } from 'zod';
import { fail, handle, ok } from '../../../../../../lib/api';
import { requireUser } from '../../../../../../lib/session';
import { reorderTodoItems } from '../../../../../../lib/todos';

export const runtime = 'nodejs';

const orderSchema = z.object({ ids: z.array(z.string().min(1).max(64)).max(2000) });

/** The manual order after a drag, as the full list of ids top to bottom. */
export async function PUT(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await context.params;
    const body = orderSchema.safeParse(await request.json().catch(() => null));
    if (!body.success) return fail(400, strings.errors.invalidPayload);
    await reorderTodoItems(user, id, body.data.ids);
    return ok({ ok: true });
  });
}
