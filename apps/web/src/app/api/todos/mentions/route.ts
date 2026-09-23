import { handle, ok } from '../../../../lib/api';
import { requireUser } from '../../../../lib/session';
import { searchMentions } from '../../../../lib/todos';

export const runtime = 'nodejs';

/**
 * What the to-do editor offers after "@" (jobs, clients, projects, tables,
 * people) or "/" (app pages) — limited to the caller's workspace and to the
 * tabs they can open.
 */
export async function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();
    const url = new URL(request.url);
    const trigger = url.searchParams.get('trigger') === '/' ? '/' : '@';
    const query = url.searchParams.get('q') ?? '';
    return ok({ results: await searchMentions(user, trigger, query) });
  });
}
