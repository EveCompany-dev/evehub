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
  { href: '/', label: strings.dashboard.title, keywords: ['dashboard', 'board', 'grade', 'inicio', 'home', 'modulos', 'widgets'] },
  { href: '/chat', label: strings.nav.chat, tab: 'chat', keywords: ['conversa', 'mensagem', 'equipe'] },
  { href: '/jobs', label: strings.nav.jobs, tab: 'jobs', keywords: ['tarefas', 'kanban', 'quadro', 'demandas'] },
  { href: '/clients', label: 'Clientes', tab: 'tables', keywords: ['cliente', 'marca', 'cnpj', 'cadastro', 'postagens', 'referencias'] },
  { href: '/tables', label: strings.nav.tables, tab: 'tables', keywords: ['tabela', 'planilha', 'dados', 'base'] },
  { href: '/connectors', label: strings.nav.connectors, tab: 'connectors', keywords: ['conexoes', 'integracoes', 'api', 'credenciais'] },
  { href: '/automations', label: strings.nav.automations, tab: 'automations', keywords: ['webhook', 'n8n', 'automacao', 'gatilho'] },
  { href: '/agenda', label: strings.nav.scheduling, tab: 'scheduling', keywords: ['agenda do time', 'calendario', 'reuniao', 'compromisso', 'evento', 'time', 'equipe'] },
  // Lives in the Agenda dropdown of the rail, so it is gated by the same tab.
  { href: '/clients/calendar', label: 'Calendário de Conteúdo', tab: 'scheduling', keywords: ['conteudo', 'postagens', 'reels', 'carrossel', 'feed', 'publicacao', 'gravacao', 'programado'] },
  { href: '/scheduling', label: 'Agendar post', tab: 'scheduling', keywords: ['posts', 'publicacao', 'instagram', 'facebook', 'meta', 'agendar', 'carrossel', 'lote'] },
  { href: '/financial', label: strings.nav.financial, tab: 'financial', keywords: ['financeiro', 'verba', 'custo', 'receita'] },
  { href: '/team', label: strings.nav.team, tab: 'team', keywords: ['equipe', 'pessoas', 'membros', 'permissoes', 'senha'] },
  { href: '/activity', label: 'Registro de atividades', tab: 'activity', keywords: ['log', 'auditoria', 'historico', 'atividades', 'quem fez'] },
  { href: '/notifications', label: strings.notifications.title, keywords: ['avisos', 'alertas', 'sino'] },
  { href: '/perfil', label: strings.profile.title, keywords: ['conta', 'senha', 'avatar', 'usuario'] },
  { href: '/settings', label: strings.dashboardSettings.title, keywords: ['configuracoes', 'ajustes', 'preferencias', 'opcoes'] },
];

/** Pages that make no sense as somewhere to open the app. */
const NOT_LANDING = new Set(['/notifications', '/perfil', '/settings']);

/**
 * Default pages that no longer exist, mapped to where they went. "Minha
 * Agenda" was a saved filter of /agenda until the agenda became the team's
 * only view (2026-09-22).
 */
const RETIRED_LANDING: Record<string, string> = { '/agenda?mine=1': '/agenda' };

/** Every page a user may pick as their default, in rail order: the routes they can see. */
export function landingOptions(visibleTabs: readonly string[]): NavRoute[] {
  return visibleRoutes(visibleTabs).filter((route) => !NOT_LANDING.has(route.href));
}

/** The chosen default if the user may still open it, else null (an old choice must never strand anyone). */
export function resolveLandingPage(defaultPage: string | null | undefined, visibleTabs: readonly string[]): string | null {
  if (!defaultPage || defaultPage === '/') return null;
  const page = RETIRED_LANDING[defaultPage] ?? defaultPage;
  return landingOptions(visibleTabs).some((route) => route.href === page) ? page : null;
}

export function visibleRoutes(visibleTabs: readonly string[]): NavRoute[] {
  return NAV_ROUTES.filter((route) => !route.tab || visibleTabs.includes(route.tab));
}
