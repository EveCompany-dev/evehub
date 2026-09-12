import { prisma } from '@eve/core';
import { strings } from '@eve/ui';
import { z } from 'zod';
import { fail, handle, ok } from '../../../../lib/api';
import { canManageTeam, validateDisable, validateOwnerChange } from '../../../../lib/permissions';
import { HttpError, requireUser } from '../../../../lib/session';

export const runtime = 'nodejs';

const patchSchema = z.object({
  isOwner: z.boolean().optional(),
  isSocialMedia: z.boolean().optional(),
  disabled: z.boolean().optional(),
});

/** Promove/rebaixa admin e ativa/desativa acesso. Somente owner. */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = await requireUser();
    if (!canManageTeam(actor)) throw new HttpError(403, strings.errors.notOwnerTeam);

    const { id } = await context.params;

    const body = patchSchema.safeParse(await request.json());
    if (!body.success) return fail(400, strings.errors.invalidPayload);

    const target = await prisma.user.findUnique({
      where: { id },
      select: { id: true, workspaceId: true, isOwner: true, disabledAt: true },
    });

    // Um id na URL nao e prova de acesso: a pessoa precisa ser do mesmo workspace.
    if (!target || target.workspaceId !== actor.workspaceId) {
      throw new HttpError(404, strings.errors.notFound);
    }

    // Contado por workspace e so entre contas ativas — um owner desativado nao
    // serve para destravar nada.
    const ownerCount = await prisma.user.count({
      where: { workspaceId: actor.workspaceId, isOwner: true, disabledAt: null },
    });

    const data: Record<string, unknown> = {};

    if (body.data.isOwner !== undefined) {
      const guard = validateOwnerChange({
        targetIsOwner: target.isOwner,
        nextIsOwner: body.data.isOwner,
        ownerCount,
      });
      if (!guard.ok) return fail(409, guard.reason ?? 'Mudanca nao permitida.');
      data.isOwner = body.data.isOwner;
    }

    if (body.data.isSocialMedia !== undefined) {
      // Tag simples, sem trava de "ultimo owner" — nada fica inacessivel por
      // desligar isto de alguem.
      data.isSocialMedia = body.data.isSocialMedia;
    }

    if (body.data.disabled !== undefined) {
      const guard = validateDisable({
        actorId: actor.id,
        targetId: target.id,
        targetIsOwner: target.isOwner,
        ownerCount,
        nextDisabled: body.data.disabled,
      });
      if (!guard.ok) return fail(409, guard.reason ?? 'Mudanca nao permitida.');
      data.disabledAt = body.data.disabled ? new Date() : null;
    }

    if (Object.keys(data).length === 0) return fail(400, strings.errors.invalidPayload);

    const updated = await prisma.user.update({
      where: { id },
      data,
      select: { id: true, name: true, email: true, image: true, isOwner: true, isSocialMedia: true, disabledAt: true },
    });

    return ok({ user: { ...updated, disabled: updated.disabledAt !== null } });
  });
}
