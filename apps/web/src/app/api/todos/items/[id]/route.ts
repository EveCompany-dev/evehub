import { strings } from '@eve/ui';
import { z } from 'zod';
import { fail, handle, ok } from '../../../../../lib/api';
import { requireUser } from '../../../../../lib/session';
import { deleteTodoItem, TODO_TEXT_MAX, todoDueDateSchema, updateTodoItem } from '../../../../../lib/todos';

export const runtime = 'nodejs';

type Context = { params: Promise<{ id: string }> };

const patchSchema = z
  .object({
    text: z.string().trim().min(1).max(TODO_TEXT_MAX).optional(),
    done: z.boolean().optional(),
    dueDate: todoDueDateSchema.optional(),
  })
  .refine((patch) => Object.keys(patch).length > 0);

export async function PATCH(request: Request, context: Context): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await context.params;
    const body = patchSchema.safeParse(await request.json().catch(() => null));
    if (!body.success) return fail(400, strings.errors.invalidPayload);
    return ok({ item: await updateTodoItem(user, id, body.data) });
  });
}

/** Returns the deleted task, so the widget can offer "Desfazer" by re-creating it in the same spot. */
export async function DELETE(_request: Request, context: Context): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await context.params;
    return ok({ item: await deleteTodoItem(user, id) });
  });
}
