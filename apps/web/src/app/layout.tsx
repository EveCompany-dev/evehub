import { parseDashboardConfig, prisma } from '@eve/core';
import { strings } from '@eve/ui';
import type { Metadata } from 'next';
import { Inter, Poppins } from 'next/font/google';
import type { JSX, ReactNode } from 'react';
import { SideRail } from '../components/SideRail';
import { getSessionUser } from '../lib/session';

import '@eve/ui/tokens.css';
import 'react-grid-layout/css/styles.css';
import './globals.css';

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
  isSocialMedia: boolean;
}

/**
 * Resolves the theme and owner/social-media flags on the server from the
 * session, so the page paints correctly on first frame (no localStorage, no
 * flash of the wrong theme) and the nav can gate tabs without a second round
 * trip. `isOwner: null` means no session — the nav renders nothing then.
 */
async function resolveSession(): Promise<LayoutSession> {
  const user = await getSessionUser();
  if (!user) return { theme: null, isOwner: null, isSocialMedia: false };

  const row = await prisma.user.findUnique({
    where: { id: user.id },
    select: { dashboardConfig: true, isOwner: true, isSocialMedia: true },
  });
  if (!row) return { theme: null, isOwner: null, isSocialMedia: false };

  const theme = parseDashboardConfig(row.dashboardConfig).theme;
  return { theme: theme === 'system' ? null : theme, isOwner: row.isOwner, isSocialMedia: row.isSocialMedia };
}

export default async function RootLayout({ children }: { children: ReactNode }): Promise<JSX.Element> {
  const { theme, isOwner, isSocialMedia } = await resolveSession();

  return (
    // suppressHydrationWarning cobre so os atributos DESTE elemento: extensoes
    // de navegador (LanguageTool, Grammarly e afins) injetam coisas como
    // data-lt-installed no <html> antes do React hidratar. Nao mascara
    // divergencia de conteudo, que continua sendo reportada normalmente.
    <html
      lang="pt-BR"
      data-theme={theme ?? undefined}
      className={`${display.variable} ${inter.variable}`}
      suppressHydrationWarning
    >
      <body>
        {children}
        {isOwner !== null && <SideRail isOwner={isOwner} isSocialMedia={isSocialMedia} />}
      </body>
    </html>
  );
}
