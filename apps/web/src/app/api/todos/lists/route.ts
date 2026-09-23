import { strings } from '@eve/ui';
import { z } from 'zod';
import { fail, handle, ok } from '../../../../lib/api';
import { requireUser } from '../../../../lib/session';
import { createTodoList, listTodoLists, TODO_LIST_NAME_MAX } from '../../../../lib/todos';

export const runtime = 'nodejs';

const createSchema = z.object({ name: z.string().trim().min(1).max(TODO_LIST_NAME_MAX) });

/** The caller's own lists. There is no way to list anyone else's — not even for an admin. */
export async function GET(): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();
    return ok({ lists: await listTodoLists(user) });
  });
}

export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();
    const body = createSchema.safeParse(await request.json().catch(() => null));
    if (!body.success) return fail(400, strings.errors.invalidPayload);
    return ok({ list: await createTodoList(user, body.data.name) }, 201);
  });
}
