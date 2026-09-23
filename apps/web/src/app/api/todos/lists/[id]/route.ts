import { strings } from '@eve/ui';
import { z } from 'zod';
import { fail, handle, ok } from '../../../../../lib/api';
import { requireUser } from '../../../../../lib/session';
import { deleteTodoList, getTodoList, renameTodoList, TODO_LIST_NAME_MAX } from '../../../../../lib/todos';

export const runtime = 'nodejs';

type Context = { params: Promise<{ id: string }> };

const patchSchema = z.object({ name: z.string().trim().min(1).max(TODO_LIST_NAME_MAX) });

/** One of the caller's lists with its tasks, plus the current label (or null = gone) of every @mention and /link in them. */
export async function GET(_request: Request, context: Context): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await context.params;
    return ok(await getTodoList(user, id));
  });
}

export async function PATCH(request: Request, context: Context): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await context.params;
    const body = patchSchema.safeParse(await request.json().catch(() => null));
    if (!body.success) return fail(400, strings.errors.invalidPayload);
    return ok({ list: await renameTodoList(user, id, body.data.name) });
  });
}

/** Deletes the list and its tasks. Only from the widget's settings, with a confirmation there. */
export async function DELETE(_request: Request, context: Context): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await context.params;
    await deleteTodoList(user, id);
    return ok({ ok: true });
  });
}
