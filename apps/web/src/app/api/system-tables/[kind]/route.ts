import { strings } from '@eve/ui';
import { handle, ok } from '../../../../lib/api';
import { HttpError, requireUser } from '../../../../lib/session';
import { ensureSystemTable, SYSTEM_TABLE_KINDS, type SystemTableKind } from '../../../../lib/system-tables';

export const runtime = 'nodejs';

/** The workspace's Calendário de Conteúdo / Perfis / Referências table (created on first request). */
export async function GET(_request: Request, context: { params: Promise<{ kind: string }> }): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();
    const { kind } = await context.params;
    if (!SYSTEM_TABLE_KINDS.includes(kind as SystemTableKind)) throw new HttpError(404, strings.errors.notFound);
    return ok({ table: await ensureSystemTable(user.workspaceId, kind as SystemTableKind) });
  });
}
