'use client';

import { useState, type JSX } from 'react';
import { DirectChatWorkspace } from './DirectChatWorkspace';
import { TeamChatWorkspace } from './TeamChatWorkspace';

export interface ChatTabsProps {
  currentUserId: string;
}

type ChatTab = 'team' | 'direct';

/** Switches /chat between the one shared team room and 1:1 private conversations. */
export function ChatTabs({ currentUserId }: ChatTabsProps): JSX.Element {
  const [tab, setTab] = useState<ChatTab>('team');

  return (
    <div className="eve-chat-tabs">
      <div className="eve-tables__tabs">
        <button type="button" className={tab === 'team' ? 'eve-tables__tab is-active' : 'eve-tables__tab'} onClick={() => setTab('team')}>
          Equipe
        </button>
        <button type="button" className={tab === 'direct' ? 'eve-tables__tab is-active' : 'eve-tables__tab'} onClick={() => setTab('direct')}>
          Privado
        </button>
      </div>

      {tab === 'team' ? <TeamChatWorkspace currentUserId={currentUserId} /> : <DirectChatWorkspace currentUserId={currentUserId} />}
    </div>
  );
}
