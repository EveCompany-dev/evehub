import { strings } from '@eve/ui';
import type { TabKey } from './permissions';

export interface NavRoute {
  href: string;
  label: string;
  /** Tab that gates this route; omit for routes every authenticated user has. */
  tab?: TabKey;
  /** Extra search terms for the Ctrl+K index. */
  keywords?: string[];
}

/**
 * Every page, once.
 *
 * The side rail renders these with icons and the Ctrl+K palette indexes them
 * for navigation — two consumers that were drifting apart while each kept its
 * own copy of the list. Icons stay in SideRail.tsx, keyed by `href`: they are
 * markup, and the palette has no use for them.
 */
export const NAV_ROUTES: NavRoute[] = [
  { href: '/', label: strings.dashboard.title, keywords: ['dashboard', 'board', 'canvas', 'inicio', 'home', 'modulos'] },
  { href: '/chat', label: strings.nav.chat, tab: 'chat', keywords: ['conversa', 'mensagem', 'equipe'] },
  { href: '/jobs', label: strings.nav.jobs, tab: 'jobs', keywords: ['tarefas', 'kanban', 'quadro', 'demandas'] },
  { href: '/clients', label: 'Clientes', tab: 'tables', keywords: ['cliente', 'marca', 'cnpj', 'cadastro', 'calendario de conteudo', 'postagens', 'referencias'] },
  { href: '/clients/calendar', label: 'Calendário de Conteúdo', tab: 'tables', keywords: ['conteudo', 'postagens', 'reels', 'carrossel', 'feed', 'publicacao', 'gravacao'] },
  { href: '/tables', label: strings.nav.tables, tab: 'tables', keywords: ['tabela', 'planilha', 'dados', 'base'] },
  { href: '/connectors', label: strings.nav.connectors, tab: 'connectors', keywords: ['conexoes', 'integracoes', 'api', 'credenciais'] },
  { href: '/automations', label: strings.nav.automations, tab: 'automations', keywords: ['webhook', 'n8n', 'automacao', 'gatilho'] },
  { href: '/agenda', label: strings.nav.scheduling, tab: 'scheduling', keywords: ['agenda', 'calendario', 'reuniao', 'compromisso', 'evento', 'time'] },
  { href: '/scheduling', label: 'Agendar post', tab: 'scheduling', keywords: ['posts', 'publicacao', 'instagram', 'facebook', 'meta', 'agendar'] },
  { href: '/financial', label: strings.nav.financial, tab: 'financial', keywords: ['financeiro', 'verba', 'custo', 'receita'] },
  { href: '/team', label: strings.nav.team, tab: 'team', keywords: ['equipe', 'pessoas', 'membros', 'permissoes'] },
  { href: '/notifications', label: strings.notifications.title, keywords: ['avisos', 'alertas', 'sino'] },
  { href: '/perfil', label: strings.profile.title, keywords: ['conta', 'senha', 'avatar', 'usuario'] },
  { href: '/settings', label: strings.dashboardSettings.title, keywords: ['configuracoes', 'ajustes', 'preferencias', 'opcoes'] },
];

export function visibleRoutes(visibleTabs: readonly string[]): NavRoute[] {
  return NAV_ROUTES.filter((route) => !route.tab || visibleTabs.includes(route.tab));
}
