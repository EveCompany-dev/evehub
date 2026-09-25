import { getRedis, withRedisTimeout } from '@eve/core';
import { strings } from '@eve/ui';
import { handle, ok } from '../../../../lib/api';
import { canViewScheduling } from '../../../../lib/permissions';
import { HttpError, requireUser } from '../../../../lib/session';

export const runtime = 'nodejs';

/** Written by the worker on every scheduling tick, with a 300 s TTL (apps/worker/src/index.ts). */
const HEARTBEAT_KEY = 'eve:worker:heartbeat';

/**
 * Whether the worker that publishes posts is alive: its heartbeat key exists.
 * An unreachable Redis reads as "not running" — the worker can't run without
 * it either.
 */
export async function GET(): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();
    if (!canViewScheduling(user)) throw new HttpError(403, strings.errors.notAllowedScheduling);

    let lastBeatAt: string | null = null;
    try {
      lastBeatAt = await withRedisTimeout(getRedis().get(HEARTBEAT_KEY));
    } catch {
      lastBeatAt = null;
    }
    return ok({ running: lastBeatAt !== null, lastBeatAt });
  });
}
