import { readWorkerHealth } from '@eve/core';
import { handle, ok } from '../../../../lib/api';
import { requireUser } from '../../../../lib/session';

export const runtime = 'nodejs';

/**
 * Whether the background worker is alive. The scheduling UI asks so it can
 * say out loud that scheduled posts are not going out — the failure mode this
 * whole endpoint exists for was a worker that had silently stopped, with the
 * app cheerfully accepting schedules nobody would ever publish.
 */
export async function GET(): Promise<Response> {
  return handle(async () => {
    await requireUser();
    return ok(await readWorkerHealth());
  });
}
