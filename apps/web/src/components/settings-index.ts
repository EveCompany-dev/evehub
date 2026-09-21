import { strings } from '@eve/ui';

/**
 * Every individual setting, declared once.
 *
 * This exists so Ctrl+K can index the settings themselves rather than only
 * the four category headings: searching "cursor" or "zoom" should land on the
 * exact control, not on a page where it might be. The `id` is both the search
 * result's identity and the `data-setting-id` anchor in SettingsSections.tsx
 * that `/settings?category=…&option=…` scrolls to and highlights — so an id
 * here with no matching anchor there is a dead link, and the pairing is
 * asserted by settings-index.test.ts.
 */
export interface SettingsOption {
  id: string;
  label: string;
  /** A SETTINGS_CATEGORIES id. */
  category: string;
  /** Extra search terms — synonyms and the words a user would actually type. */
  keywords: string[];
}

export const SETTINGS_OPTIONS: SettingsOption[] = [
  {
    id: 'mode',
    label: strings.canvas.modeTitle,
    category: 'layout',
    keywords: ['canvas', 'board', 'grade', 'grid', 'layout', 'dashboard', 'modo', 'livre', 'colunas'],
  },
  {
    id: 'backgroundImage',
    label: strings.dashboardSettings.backgroundImage,
    category: 'appearance',
    keywords: ['fundo', 'papel de parede', 'wallpaper', 'imagem', 'background'],
  },
  {
    id: 'backgroundColor',
    label: strings.dashboardSettings.backgroundColor,
    category: 'appearance',
    keywords: ['cor', 'fundo', 'background', 'hex'],
  },
  {
    id: 'density',
    label: strings.dashboardSettings.density,
    category: 'layout',
    keywords: ['densidade', 'compacto', 'espacamento', 'grade', 'linhas'],
  },
  {
    id: 'railFullHide',
    label: strings.dashboardSettings.railFullHide,
    category: 'interface',
    keywords: ['barra', 'lateral', 'rail', 'esconder', 'menu', 'navegacao'],
  },
  {
    id: 'cursorFollower',
    label: strings.dashboardSettings.cursorFollower,
    category: 'interface',
    keywords: ['cursor', 'mouse', 'bolinha', 'rastro', 'ponteiro'],
  },
  {
    id: 'defaultPage',
    label: strings.dashboardSettings.defaultPage,
    category: 'behavior',
    keywords: ['inicio', 'abrir', 'padrao', 'pagina', 'landing', 'home', 'ao entrar', 'primeira'],
  },
  {
    id: 'liveUpdates',
    label: strings.dashboardSettings.liveUpdates,
    category: 'behavior',
    keywords: ['tempo real', 'live', 'atualizar', 'sse', 'auto refresh', 'sincronizar'],
  },
];

/** Deep link that opens the right category and highlights the control. */
export function settingsHref(option: SettingsOption): string {
  return `/settings?category=${encodeURIComponent(option.category)}&option=${encodeURIComponent(option.id)}`;
}
