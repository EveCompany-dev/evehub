import { runSync } from '@eve/core';
import { logActivity, quoted } from '../../../../../lib/activity';
import { fail, handle, ok } from '../../../../../lib/api';
import { requireInstance, requireUser } from '../../../../../lib/session';

export const runtime = 'nodejs';

/**
 * On-demand sync ("Sincronizar agora" in the widget menu).
 *
 * Runs in the web process rather than enqueueing, so the user gets the result
 * in the same request. The scheduled path stays the worker's job.
 */
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await context.params;
    const instance = await requireInstance(id, user);

    const result = await runSync(id);
    await logActivity(user, {
      action: 'connector.sync',
      summary: `sincronizou o conector ${quoted(instance.label)} manualmente${result.ok ? '' : ' (falhou)'}`,
      entityType: 'connectorInstance',
      entityId: id,
    });
    if (!result.ok) return fail(502, result.error ?? 'Sincronização falhou.');

    return ok({ ok: true, recordCount: result.recordCount ?? 0 });
  });
}
