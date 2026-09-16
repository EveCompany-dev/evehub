import { prisma } from '@eve/core';
import { strings } from '@eve/ui';
import { z } from 'zod';
import { fail, handle, ok } from '../../../../lib/api';
import {
  canManageTeam,
  validateDelete,
  validateDisable,
  validateOwnerChange,
  validateOwnerGrant,
} from '../../../../lib/permissions';
import { HttpError, requireUser } from '../../../../lib/session';

export const runtime = 'nodejs';

const patchSchema = z.object({
  isOwner: z.boolean().optional(),
  isSocialMedia: z.boolean().optional(),
  disabled: z.boolean().optional(),
  /** null unassigns. */
  roleId: z.string().min(1).nullable().optional(),
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
      // Dar admin so na criacao: a lista so rebaixa.
      const grantGuard = validateOwnerGrant({ targetIsOwner: target.isOwner, nextIsOwner: body.data.isOwner });
      if (!grantGuard.ok) return fail(409, grantGuard.reason ?? 'Mudança não permitida.');

      const guard = validateOwnerChange({
        targetIsOwner: target.isOwner,
        nextIsOwner: body.data.isOwner,
        ownerCount,
      });
      if (!guard.ok) return fail(409, guard.reason ?? 'Mudança não permitida.');
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
      if (!guard.ok) return fail(409, guard.reason ?? 'Mudança não permitida.');
      data.disabledAt = body.data.disabled ? new Date() : null;
    }

    if (body.data.roleId !== undefined) {
      if (body.data.roleId) {
        const role = await prisma.role.findUnique({ where: { id: body.data.roleId } });
        if (!role || role.workspaceId !== actor.workspaceId) throw new HttpError(404, strings.errors.notFound);
      }
      data.roleId = body.data.roleId;
    }

    if (Object.keys(data).length === 0) return fail(400, strings.errors.invalidPayload);

    const updated = await prisma.user.update({
      where: { id },
      data,
      select: {
        id: true,
        name: true,
        email: true,
        image: true,
        isOwner: true,
        isSocialMedia: true,
        disabledAt: true,
        role: { select: { id: true, name: true } },
      },
    });

    return ok({
      user: {
        ...updated,
        disabled: updated.disabledAt !== null,
        roleId: updated.role?.id ?? null,
        roleName: updated.role?.name ?? null,
      },
    });
  });
}

/**
 * Conteudo que pertence ao workspace, nao a pessoa.
 *
 * Cada um destes e uma FK `RESTRICT` no schema: o banco recusaria o delete de
 * qualquer jeito, com um erro de constraint que nao diz nada a quem clicou.
 * Contamos antes para poder dizer exatamente o que esta segurando a conta.
 *
 * `EditLog` de proposito nao esta aqui — ver o comentario no DELETE.
 */
async function countOwnedContent(userId: string): Promise<{ label: string; count: number }[]> {
  const [jobs, comments, financial, messages, attachments, posts] = await Promise.all([
    prisma.job.count({ where: { createdBy: userId } }),
    prisma.jobComment.count({ where: { authorId: userId } }),
    prisma.financialEntry.count({ where: { createdBy: userId } }),
    prisma.teamMessage.count({ where: { authorId: userId } }),
    prisma.attachment.count({ where: { uploadedBy: userId } }),
    prisma.scheduledPost.count({ where: { createdBy: userId } }),
  ]);

  return [
    { label: 'job(s)', count: jobs },
    { label: 'comentário(s)', count: comments },
    { label: 'lançamento(s) no financeiro', count: financial },
    { label: 'mensagem(ns) no chat', count: messages },
    { label: 'anexo(s)', count: attachments },
    { label: 'post(s) agendado(s)', count: posts },
  ].filter((row) => row.count > 0);
}

/**
 * Apaga a conta de vez. Somente owner, e somente depois de desativada.
 *
 * Desativar continua sendo o caminho normal — isto aqui e para a conta que
 * nunca deveria ter existido (e-mail errado, pessoa que nunca entrou) e para
 * quem saiu sem deixar rastro de trabalho.
 *
 * O que some junto: sessao, contas Google vinculadas, notificacoes, mencoes,
 * apontamento de horas e participacao em jobs (tudo `Cascade` no schema, tudo
 * so faz sentido junto da pessoa). O que impede o delete: qualquer conteudo do
 * workspace (ver countOwnedContent) — job, comentario, lancamento, mensagem.
 * Essas coisas sao da agencia e continuam valendo depois que a pessoa sai.
 *
 * `EditLog` e o caso do meio, e por isso e tratado aqui: e trilha de auditoria
 * das edicoes empurradas para Meta/Google, tem que sobreviver — mas uma unica
 * edicao num campo nao pode prender uma conta para sempre. Entao gravamos o
 * nome do autor na propria entrada e soltamos a FK: a trilha continua legivel
 * sem a conta.
 */
export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = await requireUser();
    if (!canManageTeam(actor)) throw new HttpError(403, strings.errors.notOwnerTeam);

    const { id } = await context.params;

    const target = await prisma.user.findUnique({
      where: { id },
      select: { id: true, name: true, email: true, workspaceId: true, isOwner: true, disabledAt: true },
    });

    if (!target || target.workspaceId !== actor.workspaceId) {
      throw new HttpError(404, strings.errors.notFound);
    }

    const ownerCount = await prisma.user.count({
      where: { workspaceId: actor.workspaceId, isOwner: true, disabledAt: null },
    });

    const guard = validateDelete({
      actorId: actor.id,
      targetId: target.id,
      targetIsOwner: target.isOwner,
      targetDisabled: target.disabledAt !== null,
      ownerCount,
    });
    if (!guard.ok) return fail(409, guard.reason ?? 'Remoção não permitida.');

    const blocking = await countOwnedContent(target.id);
    if (blocking.length > 0) {
      const summary = blocking.map((row) => `${row.count} ${row.label}`).join(', ');
      return fail(
        409,
        `Esta conta não pode ser apagada porque o trabalho dela continua no workspace: ${summary}. ` +
          'Isso é da agência e sumiria junto. Deixe a conta desativada — ela já não tem acesso a nada.',
      );
    }

    await prisma.$transaction(async (tx) => {
      // Preserva o autor na trilha ANTES de soltar a FK (o SetNull do delete
      // levaria o userId junto e a entrada viraria "autor desconhecido").
      await tx.editLog.updateMany({
        where: { userId: target.id },
        data: { userLabel: target.name ?? target.email },
      });
      await tx.user.delete({ where: { id: target.id } });
    });

    return ok({ deleted: true });
  });
}
