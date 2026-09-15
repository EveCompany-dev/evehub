import { parseDashboardConfig, prisma } from '@eve/core';
import { strings } from '@eve/ui';
import type { Metadata } from 'next';
import { Inter, Poppins } from 'next/font/google';
import type { JSX, ReactNode } from 'react';
import { CustomCursor } from '../components/CustomCursor';
import { SideRail } from '../components/SideRail';
import { TimerProvider } from '../components/TimerProvider';
import { getVisibleTabs, toTabSubject, type TabKey } from '../lib/permissions';
import { getSessionUser } from '../lib/session';

import '@eve/ui/tokens.css';
import 'react-grid-layout/css/styles.css';
import './globals.css';
import '../styles/canvas.css';

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
  uiScale: number;
  railFullHide: boolean;
  cursorFollower: boolean;
}

const DEFAULT_UI_SCALE = 1.5;

/**
 * Resolves the theme, owner/tab-visibility, and UI-scale/rail prefs on the
 * server from the session, so the page paints correctly on first frame (no
 * localStorage, no flash of the wrong theme/scale) and the nav can gate tabs
 * without a second round trip. `isOwner: null` means no session — the nav
 * renders nothing then, and the default 150% scale still applies (a
 * logged-out visitor gets the same readable-by-default sizing).
 */
async function resolveSession(): Promise<LayoutSession> {
  const user = await getSessionUser();
  if (!user) return { theme: null, isOwner: null, visibleTabs: new Set(), uiScale: DEFAULT_UI_SCALE, railFullHide: false, cursorFollower: true };

  const row = await prisma.user.findUnique({
    where: { id: user.id },
    select: { dashboardConfig: true, isOwner: true, isSocialMedia: true, role: { select: { tabs: true } } },
  });
  if (!row) return { theme: null, isOwner: null, visibleTabs: new Set(), uiScale: DEFAULT_UI_SCALE, railFullHide: false, cursorFollower: true };

  const config = parseDashboardConfig(row.dashboardConfig);
  return {
    theme: config.theme === 'system' ? null : config.theme,
    isOwner: row.isOwner,
    visibleTabs: getVisibleTabs(toTabSubject(row)),
    uiScale: config.uiScale,
    railFullHide: config.railFullHide,
    cursorFollower: config.cursorFollower,
  };
}

export default async function RootLayout({ children }: { children: ReactNode }): Promise<JSX.Element> {
  const { theme, isOwner, visibleTabs, uiScale, railFullHide, cursorFollower } = await resolveSession();

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
        {/* Server-rendered so the scale applies on the very first paint —
            setting it after hydration would flash the 100% layout first. */}
        <style>{`html { zoom: ${uiScale}; }`}</style>
      </head>
      <body>
        {cursorFollower ? <CustomCursor /> : null}
        {isOwner !== null ? (
          <TimerProvider>
            {children}
            <SideRail visibleTabs={[...visibleTabs]} railFullHide={railFullHide} />
          </TimerProvider>
        ) : (
          children
        )}
      </body>
    </html>
  );
}
