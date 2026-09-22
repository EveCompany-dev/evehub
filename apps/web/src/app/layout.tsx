import { parseDashboardConfig, prisma } from '@eve/core';
import { strings } from '@eve/ui';
import type { Metadata } from 'next';
import { Inter, Poppins } from 'next/font/google';
import type { JSX, ReactNode } from 'react';
import { BugReportPill } from '../components/BugReportPill';
import { CustomCursor } from '../components/CustomCursor';
import { DragZoomGuard } from '../components/DragZoomGuard';
import { SideRail } from '../components/SideRail';
import { TimerProvider } from '../components/TimerProvider';
import { getVisibleTabs, toTabSubject, type TabKey } from '../lib/permissions';
import { getSessionUser } from '../lib/session';

import '@eve/ui/tokens.css';
import 'react-grid-layout/css/styles.css';
import './globals.css';
import '../styles/tables.css';

// Poppins: geometrica, e a mais proxima do logotipo da Eve entre as fontes
// livres. NAO e a fonte oficial da marca — se o manual especificar outra,
// troque aqui e em globals.css.
const display = Poppins({ subsets: ['latin'], weight: ['500', '600', '700'], variable: '--font-display-face' });
const inter = Inter({ subsets: ['latin'], weight: ['400', '500', '600'], variable: '--font-inter' });

export const metadata: Metadata = {
  title: strings.app.name,
  description: strings.app.tagline,
};

interface LayoutSession {
  theme: 'dark' | 'light' | null;
  isOwner: boolean | null;
  visibleTabs: Set<TabKey>;
  railFullHide: boolean;
  cursorFollower: boolean;
}

/**
 * Resolves the theme, owner/tab-visibility, and rail prefs on the server
 * from the session, so the page paints correctly on first frame (no
 * localStorage, no flash of the wrong theme) and the nav can gate tabs
 * without a second round trip. `isOwner: null` means no session — the nav
 * renders nothing then.
 */
async function resolveSession(): Promise<LayoutSession> {
  const user = await getSessionUser();
  if (!user) return { theme: null, isOwner: null, visibleTabs: new Set(), railFullHide: false, cursorFollower: true };

  const row = await prisma.user.findUnique({
    where: { id: user.id },
    select: { dashboardConfig: true, isOwner: true, isSocialMedia: true, role: { select: { tabs: true } } },
  });
  if (!row) return { theme: null, isOwner: null, visibleTabs: new Set(), railFullHide: false, cursorFollower: true };

  const config = parseDashboardConfig(row.dashboardConfig);
  return {
    theme: config.theme === 'system' ? null : config.theme,
    isOwner: row.isOwner,
    visibleTabs: getVisibleTabs(toTabSubject(row)),
    railFullHide: config.railFullHide,
    cursorFollower: config.cursorFollower,
  };
}

export default async function RootLayout({ children }: { children: ReactNode }): Promise<JSX.Element> {
  const { theme, isOwner, visibleTabs, railFullHide, cursorFollower } = await resolveSession();

  return (
    // suppressHydrationWarning cobre so os atributos DESTE elemento: extensoes
    // de navegador (LanguageTool, Grammarly e afins) injetam coisas como
    // data-lt-installed no <html> antes do React hidratar. Nao mascara
    // divergencia de conteudo, que continua sendo reportada normalmente.
    <html
      lang="pt-BR"
      data-theme={theme ?? undefined}
      data-cursor-follower={cursorFollower ? 'on' : 'off'}
      className={`${display.variable} ${inter.variable}`}
      suppressHydrationWarning
    >
      <head>
        {/* The Interface-scale slider (uiScale) is removed for now — it was the
            root cause of nearly every drag/positioning/sizing bug this app hit
            (dnd-kit drift, context-menu drift, react-grid-layout drift, dvh
            overflow, native drag-and-drop hit-testing). Zoom is pinned to 100%,
            full stop, rather than patched further. This tag is kept only as the
            one place `applyUiScale` (SettingsSections.tsx) still writes through
            — currently just SettingsWorkspace's reset button, always with 1. */}
        <style id="eve-ui-scale">{`html { zoom: 1; }`}</style>
      </head>
      <body>
        <DragZoomGuard />
        {cursorFollower ? <CustomCursor /> : null}
        {isOwner !== null ? (
          <TimerProvider>
            {children}
            <SideRail visibleTabs={[...visibleTabs]} railFullHide={railFullHide} />
            <BugReportPill />
          </TimerProvider>
        ) : (
          children
        )}
      </body>
    </html>
  );
}
