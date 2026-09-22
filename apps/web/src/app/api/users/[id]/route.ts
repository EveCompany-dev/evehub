import { isAdminEmail, prisma } from '@eve/core';
import { strings } from '@eve/ui';
import { z } from 'zod';
import { logActivity, personLabel, quoted, type ActivityEntry } from '../../../../lib/activity';
import { fail, handle, ok } from '../../../../lib/api';
import { canManageTeam, validateDelete, validateDisable, validateEmailChange } from '../../../../lib/permissions';
import { HttpError, requireUser } from '../../../../lib/session';
import { deleteUpload } from '../../../../lib/uploads';

export const runtime = 'nodejs';

const patchSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  email: z.string().trim().toLowerCase().email().max(200).optional(),
  isSocialMedia: z.boolean().optional(),
  disabled: z.boolean().optional(),
  /** null unassigns. */
  roleId: z.string().min(1).nullable().optional(),
});

/**
 * Edita alguem da equipe: nome, e-mail, tag Social Media, cargo, e
 * ativa/desativa o acesso. Somente admin. Admin em si nao se da nem se tira
 * por aqui — sai do e-mail (ver @eve/core/admins).
 */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = await requireUser();
    if (!canManageTeam(actor)) throw new HttpError(403, strings.errors.notOwnerTeam);

    const { id } = await context.params;

    const body = patchSchema.safeParse(await request.json());
    if (!body.success) return fail(400, body.error.issues.map((issue) => issue.message).join('; ') || strings.errors.invalidPayload);

    const target = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        email: true,
        workspaceId: true,
        isSocialMedia: true,
        disabledAt: true,
        deletedAt: true,
        role: { select: { id: true, name: true } },
      },
    });

    // Um id na URL nao e prova de acesso: a pessoa precisa ser do mesmo
    // workspace. Conta apagada e lapide — nao se edita.
    if (!target || target.workspaceId !== actor.workspaceId || target.deletedAt) {
      throw new HttpError(404, strings.errors.notFound);
    }

    const targetIsAdmin = isAdminEmail(target.email);
    const who = personLabel(target);
    const data: Record<string, unknown> = {};
    const entries: ActivityEntry[] = [];
    const entity = { entityType: 'user', entityId: target.id };

    if (body.data.name !== undefined && body.data.name !== target.name) {
      data.name = body.data.name;
      entries.push({ action: 'user.update', summary: `renomeou ${who} para ${quoted(body.data.name)}`, ...entity });
    }

    if (body.data.email !== undefined && body.data.email !== target.email.toLowerCase()) {
      const guard = validateEmailChange({
        actorIsAdmin: true,
        currentIsAdminEmail: targetIsAdmin,
        nextIsAdminEmail: isAdminEmail(body.data.email),
      });
      if (!guard.ok) return fail(409, guard.reason ?? 'Mudança não permitida.');

      const taken = await prisma.user.findUnique({ where: { email: body.data.email }, select: { id: true } });
      if (taken) return fail(409, 'Esse e-mail já está em uso por outra conta.');

      data.email = body.data.email;
      entries.push({ action: 'user.update', summary: `trocou o e-mail de ${who} de ${target.email} para ${body.data.email}`, ...entity });
    }

    if (body.data.isSocialMedia !== undefined && body.data.isSocialMedia !== target.isSocialMedia) {
      // Tag simples — nada fica inacessivel por desligar isto de alguem.
      data.isSocialMedia = body.data.isSocialMedia;
      entries.push({
        action: 'user.update',
        summary: body.data.isSocialMedia ? `marcou ${who} como Social Media` : `tirou a tag Social Media de ${who}`,
        ...entity,
      });
    }

    if (body.data.disabled !== undefined && body.data.disabled !== (target.disabledAt !== null)) {
      const guard = validateDisable({
        actorId: actor.id,
        targetId: target.id,
        targetIsAdmin,
        nextDisabled: body.data.disabled,
      });
      if (!guard.ok) return fail(409, guard.reason ?? 'Mudança não permitida.');
      data.disabledAt = body.data.disabled ? new Date() : null;
      entries.push({
        action: body.data.disabled ? 'user.disable' : 'user.enable',
        summary: body.data.disabled ? `desativou a conta de ${who}` : `reativou a conta de ${who}`,
        ...entity,
      });
    }

    if (body.data.roleId !== undefined && body.data.roleId !== (target.role?.id ?? null)) {
      let roleName: string | null = null;
      if (body.data.roleId) {
        const role = await prisma.role.findUnique({ where: { id: body.data.roleId } });
        if (!role || role.workspaceId !== actor.workspaceId) throw new HttpError(404, strings.errors.notFound);
        roleName = role.name;
      }
      data.roleId = body.data.roleId;
      entries.push({
        action: 'user.role',
        summary: roleName ? `deu o cargo ${quoted(roleName)} a ${who}` : `tirou o cargo ${quoted(target.role?.name)} de ${who}`,
        ...entity,
      });
    }

    if (Object.keys(data).length > 0) {
      await prisma.user.update({ where: { id }, data });
      for (const entry of entries) await logActivity(actor, entry);
    }

    const updated = await prisma.user.findUniqueOrThrow({
      where: { id },
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
 * Quanto trabalho da pessoa fica no workspace depois de apagar — so para o
 * registro de atividades dizer o que ficou. Nao trava mais nada.
 */
async function countOwnedContent(userId: string): Promise<Record<string, number>> {
  const [jobs, comments, financial, messages, attachments, posts] = await Promise.all([
    prisma.job.count({ where: { createdBy: userId } }),
    prisma.jobComment.count({ where: { authorId: userId } }),
    prisma.financialEntry.count({ where: { createdBy: userId } }),
    prisma.teamMessage.count({ where: { authorId: userId } }),
    prisma.attachment.count({ where: { uploadedBy: userId } }),
    prisma.scheduledPost.count({ where: { createdBy: userId } }),
  ]);
  return { jobs, comments, financial, messages, attachments, posts };
}

/**
 * Arquivos que so existem por causa da pessoa: foto de perfil, fundo da
 * dashboard e as imagens que ela soltava no antigo board livre (canvas,
 * removido em 2026-09-22 — os arquivos antigos ainda podem estar no disco).
 */
const PERSONAL_UPLOAD = /^\/uploads\/(avatars|backgrounds|canvas)\/[^/?#]+$/;

function personalUploads(image: string | null, dashboardConfig: unknown): string[] {
  const found = new Set<string>();
  const visit = (value: unknown): void => {
    if (typeof value === 'string') {
      const pathname = value.startsWith('/') ? value : (() => {
        try {
          return new URL(value).pathname;
        } catch {
          return '';
        }
      })();
      if (PERSONAL_UPLOAD.test(pathname)) found.add(pathname);
    } else if (Array.isArray(value)) {
      value.forEach(visit);
    } else if (value && typeof value === 'object') {
      Object.values(value).forEach(visit);
    }
  };
  visit(image);
  visit(dashboardConfig);
  return [...found];
}

/**
 * Apaga a conta. Somente admin, e somente depois de desativada.
 *
 * Funciona mesmo quando a pessoa tem jobs, comentarios e mensagens no chat da
 * equipe: esse trabalho e da agencia e fica, assinado so com o nome. Tudo o
 * que e *da pessoa* sai: e-mail (a linha passa a usar um endereco .invalid, o
 * que libera o original para uma conta nova), senha, contas Google
 * vinculadas, sessoes, foto e arquivos pessoais, notificacoes, mencoes,
 * cargos, participacao em jobs e na agenda, tarefas atribuidas, pedidos de
 * senha e o layout da dashboard. A conta fica inalcancavel: sem e-mail, sem
 * senha, sem Google, e o login pelo Google nao recria conta para quem nao foi
 * cadastrado (ver auth.ts).
 *
 * A linha em si fica como lapide porque dezenas de tabelas apontam para o
 * autor, e o registro de atividades precisa continuar dizendo quem fez o que.
 * Conversas privadas continuam para a outra pessoa, que era metade delas.
 */
export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const actor = await requireUser();
    if (!canManageTeam(actor)) throw new HttpError(403, strings.errors.notOwnerTeam);

    const { id } = await context.params;

    const target = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        email: true,
        image: true,
        workspaceId: true,
        disabledAt: true,
        deletedAt: true,
        dashboardConfig: true,
      },
    });

    if (!target || target.workspaceId !== actor.workspaceId || target.deletedAt) {
      throw new HttpError(404, strings.errors.notFound);
    }

    const guard = validateDelete({
      actorId: actor.id,
      targetId: target.id,
      targetIsAdmin: isAdminEmail(target.email),
      targetDisabled: target.disabledAt !== null,
    });
    if (!guard.ok) return fail(409, guard.reason ?? 'Remoção não permitida.');

    const name = target.name?.trim() || null;
    const label = name ?? target.email;
    const kept = await countOwnedContent(target.id);
    const files = personalUploads(target.image, target.dashboardConfig);
    const now = new Date();

    await prisma.$transaction(async (tx) => {
      // Trilha das edicoes em Meta/Google: o nome fica gravado na propria
      // entrada, como sempre foi feito ao apagar alguem.
      await tx.editLog.updateMany({ where: { userId: target.id }, data: { userLabel: label } });

      await tx.account.deleteMany({ where: { userId: target.id } });
      await tx.session.deleteMany({ where: { userId: target.id } });
      await tx.notification.deleteMany({ where: { userId: target.id } });
      await tx.teamMessageMention.deleteMany({ where: { userId: target.id } });
      await tx.jobCollaborator.deleteMany({ where: { userId: target.id } });
      await tx.agendaEventAttendee.deleteMany({ where: { userId: target.id } });
      await tx.passwordResetRequest.deleteMany({ where: { userId: target.id } });
      await tx.jobTask.updateMany({ where: { assigneeId: target.id }, data: { assigneeId: null } });
      // Um cronometro esquecido rodando ficaria contando horas para sempre.
      await tx.timeEntry.updateMany({ where: { userId: target.id, endedAt: null }, data: { endedAt: now } });

      await tx.user.update({
        where: { id: target.id },
        data: {
          email: `removido-${target.id}@contas-removidas.invalid`,
          name: name ? `${name} (conta removida)` : 'Conta removida',
          image: null,
          emailVerified: null,
          passwordHash: null,
          isOwner: false,
          isSocialMedia: false,
          roleId: null,
          dashboardConfig: {},
          lastSeenAt: null,
          disabledAt: target.disabledAt ?? now,
          deletedAt: now,
        },
      });
    });

    // Depois do commit: um arquivo que nao apaga nao pode desfazer a remocao.
    await Promise.all(files.map((file) => deleteUpload(file)));

    await logActivity(actor, {
      action: 'user.delete',
      summary: `apagou a conta de ${label} (${target.email}); o trabalho no workspace ficou assinado só com o nome`,
      entityType: 'user',
      entityId: target.id,
      details: { kept, filesRemoved: files.length },
    });

    return ok({ deleted: true });
  });
}
