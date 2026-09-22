/**
 * As areas do registro de atividades, para o filtro da tela e para a API.
 * Arquivo puro: a pagina (client) e a rota (servidor) importam o mesmo.
 *
 * Uma area e um conjunto de prefixos de `ActivityLog.action` ("job.create"
 * cai em "job."). Acao nova com prefixo novo precisa entrar aqui, senao so
 * aparece com o filtro "Todas".
 */
export interface ActivityArea {
  key: string;
  label: string;
  prefixes: string[];
}

export const ACTIVITY_AREAS: ActivityArea[] = [
  { key: 'jobs', label: 'Jobs', prefixes: ['job.'] },
  { key: 'tables', label: 'Tabelas', prefixes: ['table.'] },
  { key: 'clients', label: 'Clientes e projetos', prefixes: ['client.', 'project.'] },
  { key: 'agenda', label: 'Agenda', prefixes: ['agenda.'] },
  { key: 'posts', label: 'Posts agendados', prefixes: ['post.'] },
  { key: 'financial', label: 'Financeiro', prefixes: ['financial.'] },
  { key: 'connectors', label: 'Conectores', prefixes: ['connector.'] },
  { key: 'automations', label: 'Automações', prefixes: ['automation.'] },
  { key: 'chat', label: 'Chat da equipe', prefixes: ['chat.'] },
  { key: 'team', label: 'Equipe e cargos', prefixes: ['user.', 'role.'] },
  { key: 'access', label: 'Acesso e senhas', prefixes: ['auth.', 'profile.'] },
  { key: 'feedback', label: 'Relatos de bug', prefixes: ['bug.'] },
];

export function areaForAction(action: string): ActivityArea | null {
  return ACTIVITY_AREAS.find((area) => area.prefixes.some((prefix) => action.startsWith(prefix))) ?? null;
}
