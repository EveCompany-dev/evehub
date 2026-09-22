/**
 * Quem administra o Eve Hub. Lista fechada, no codigo, de proposito.
 *
 * Antes o admin era um checkbox (`User.isOwner`) que qualquer owner podia
 * marcar ao criar uma conta — e cada owner a mais era mais alguem com acesso
 * as credenciais de Meta e Google Ads dos clientes. Agora nenhuma tela, rota
 * ou cargo concede admin: so estes e-mails. Mudar a lista e um commit, com
 * autor e data, e nao um clique.
 *
 * `User.isOwner` continua existindo como espelho desta lista (o worker e
 * algumas paginas leem a coluna), e a sessao reescreve a coluna quando ela
 * diverge — ver auth.ts.
 *
 * Arquivo puro (sem Prisma), exportado em `@eve/core/admins` para poder ser
 * importado por componente client sem arrastar o banco para o bundle.
 */
export const ADMIN_EMAILS: readonly string[] = ['jose@evecompany.com.br', 'financeiro@evecompany.com.br'];

const normalized = new Set(ADMIN_EMAILS.map((email) => email.toLowerCase()));

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return normalized.has(email.trim().toLowerCase());
}
