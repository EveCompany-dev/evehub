import { prisma } from '@eve/core';
import { strings } from '@eve/ui';
import { z } from 'zod';
import { logAnonymousActivity } from '../../../../lib/activity';
import { fail, handle, ok } from '../../../../lib/api';
import { pendingRequestWhere } from '../../../../lib/password-reset';
import { consumeRateLimit } from '../../../../lib/rate-limit';

export const runtime = 'nodejs';

const HOUR_MS = 60 * 60 * 1000;

const requestSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
});

function clientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded || request.headers.get('x-real-ip') || 'unknown';
}

/**
 * "Esqueci minha senha", na tela de login — sem sessao, de proposito.
 *
 * A resposta e sempre a mesma, exista a conta ou nao: senao o formulario
 * vira um jeito de descobrir quem tem conta no Eve Hub. O efeito so acontece
 * para conta ativa: abre um pedido (um por vez por pessoa) e avisa os admins,
 * que geram o link na tela de Equipe.
 */
export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    const body = requestSchema.safeParse(await request.json().catch(() => ({})));
    if (!body.success) return fail(400, 'Informe um e-mail válido.');

    const email = body.data.email;

    const [byIp, byEmail] = await Promise.all([
      consumeRateLimit('pwreset-ip', clientIp(request), 10, HOUR_MS),
      consumeRateLimit('pwreset-email', email, 3, HOUR_MS),
    ]);
    if (!byIp.allowed || !byEmail.allowed) return fail(429, strings.auth.tooManyAttempts);

    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, name: true, email: true, workspaceId: true, disabledAt: true },
    });

    if (user && !user.disabledAt) {
      const open = await prisma.passwordResetRequest.findFirst({
        where: { userId: user.id, ...pendingRequestWhere() },
        select: { id: true },
      });

      // Um pedido ja aberto basta: apertar o botao cinco vezes nao pode virar
      // cinco avisos para cada admin.
      if (!open) {
        const created = await prisma.passwordResetRequest.create({
          data: { workspaceId: user.workspaceId, userId: user.id },
          select: { id: true },
        });

        const admins = await prisma.user.findMany({
          where: { workspaceId: user.workspaceId, isOwner: true, disabledAt: null },
          select: { id: true },
        });
        const who = user.name?.trim() || user.email;
        if (admins.length > 0) {
          await prisma.notification.createMany({
            data: admins.map((admin) => ({
              workspaceId: user.workspaceId,
              userId: admin.id,
              type: 'passwordResetRequested' as const,
              message: `${who} esqueceu a senha e pediu um link de redefinição. Gere o link em Equipe.`,
            })),
          });
        }

        await logAnonymousActivity(user.workspaceId, user, {
          action: 'auth.passwordResetRequested',
          summary: 'pediu para redefinir a senha (esqueci minha senha)',
          entityType: 'passwordResetRequest',
          entityId: created.id,
        });
      }
    }

    return ok({ ok: true });
  });
}
