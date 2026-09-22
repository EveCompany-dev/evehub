import { prisma } from '@eve/core';
import { createHash, randomBytes } from 'node:crypto';

/**
 * Recuperacao de senha sem e-mail: a pessoa pede na tela de login, os admins
 * sao avisados, e um deles gera um link de uso unico e entrega por fora.
 *
 * O token so existe em claro na resposta ao admin; no banco fica o SHA-256.
 * SHA-256 e nao argon2 porque o token ja tem 256 bits aleatorios — nao ha
 * dicionario para atacar, e a busca precisa ser por igualdade (indice unico).
 */
export const RESET_LINK_TTL_MS = 24 * 60 * 60 * 1000;

/** Pedido sem resposta por mais que isso deixa de aparecer como pendente — a pessoa pede de novo. */
export const RESET_REQUEST_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const RESET_LINK_INVALID = 'Este link é inválido, já foi usado ou expirou. Peça um novo a um administrador.';

export function hashResetToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function generateResetToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, tokenHash: hashResetToken(token) };
}

export function resetLinkPath(token: string): string {
  return `/redefinir-senha?token=${encodeURIComponent(token)}`;
}

/** Pedidos ainda sem link e sem resposta: o que a tela de Equipe mostra como pendente. */
export function pendingRequestWhere(now = new Date()) {
  return {
    issuedAt: null,
    dismissedAt: null,
    usedAt: null,
    createdAt: { gte: new Date(now.getTime() - RESET_REQUEST_TTL_MS) },
  };
}

/**
 * O pedido por tras de um token, se o link ainda vale: emitido, nao usado,
 * nao descartado, dentro do prazo, e a conta ainda ativa. Nao consome nada —
 * quem troca a senha reivindica o pedido de forma atomica (ver a rota).
 */
export async function findUsableReset(token: string, now = new Date()) {
  if (!token || token.length < 20 || token.length > 200) return null;

  const request = await prisma.passwordResetRequest.findUnique({
    where: { tokenHash: hashResetToken(token) },
    include: { user: { select: { id: true, name: true, email: true, workspaceId: true, disabledAt: true } } },
  });

  if (!request || request.usedAt || request.dismissedAt || !request.issuedAt) return null;
  if (!request.tokenExpiresAt || request.tokenExpiresAt.getTime() <= now.getTime()) return null;
  if (request.user.disabledAt) return null;
  return request;
}
