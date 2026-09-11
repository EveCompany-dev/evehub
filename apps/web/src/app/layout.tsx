import { parseDashboardConfig, prisma } from '@eve/core';
import { strings } from '@eve/ui';
import type { Metadata } from 'next';
import { Inter, Poppins } from 'next/font/google';
import type { JSX, ReactNode } from 'react';
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

/**
 * Resolves the theme on the server from the user's saved preference, so the
 * page paints correctly on first frame. No localStorage, no flash of the wrong
 * theme, and "system" simply stamps nothing and lets the media query decide.
 */
async function resolveTheme(): Promise<'dark' | 'light' | null> {
  const user = await getSessionUser();
  if (!user) return null;

  const row = await prisma.user.findUnique({ where: { id: user.id }, select: { dashboardConfig: true } });
  const theme = parseDashboardConfig(row?.dashboardConfig).theme;
  return theme === 'system' ? null : theme;
}

export default async function RootLayout({ children }: { children: ReactNode }): Promise<JSX.Element> {
  const theme = await resolveTheme();

  return (
    <html lang="pt-BR" data-theme={theme ?? undefined} className={`${display.variable} ${inter.variable}`}>
      <body>{children}</body>
    </html>
  );
}
