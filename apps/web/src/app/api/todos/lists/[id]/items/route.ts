import { strings } from '@eve/ui';
import { z } from 'zod';
import { fail, handle, ok } from '../../../../../../lib/api';
import { requireUser } from '../../../../../../lib/session';
import { addTodoItems, TODO_TEXT_MAX, todoDueDateSchema } from '../../../../../../lib/todos';

export const runtime = 'nodejs';

const createSchema = z.object({
  text: z.string().trim().min(1).max(TODO_TEXT_MAX),
  dueDate: todoDueDateSchema.optional(),
  done: z.boolean().optional(),
  /** Where to insert (0 = top). Omitted = at the bottom. Undoing a delete sends the old spot. */
  position: z.number().int().min(0).max(100_000).optional(),
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await context.params;
    const body = createSchema.safeParse(await request.json().catch(() => null));
    if (!body.success) return fail(400, strings.errors.invalidPayload);

    const { position, ...item } = body.data;
    const [created] = await addTodoItems(user, id, [item], position);
    return ok({ item: created }, 201);
  });
}
