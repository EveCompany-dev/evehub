'use client';

import { useSearchParams } from 'next/navigation';
import type { JSX } from 'react';
import { AgendaWorkspace } from './AgendaWorkspace';

export interface AgendaPageBodyProps {
  currentUserId: string;
}

/** Reads ?mine=1 (from the Agenda nav dropdown's "Minha Agenda") — a client wrapper since the page itself is a server component. */
export function AgendaPageBody({ currentUserId }: AgendaPageBodyProps): JSX.Element {
  const searchParams = useSearchParams();
  const mine = searchParams.get('mine') === '1';

  return <AgendaWorkspace currentUserId={currentUserId} initialMemberFilter={mine ? currentUserId : undefined} />;
}
