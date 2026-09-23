'use client';

import type { ChatMessage } from '@eve/connector-chat/shared';
import { DevBadge, SettingsRow, SettingsSection, strings, WidgetShell } from '@eve/ui';
import { useEffect, useId, useRef, useState, type FormEvent, type JSX } from 'react';
import { linkify } from '../components/Linkify';
import type { WidgetProps } from './types';

/**
 * Plain conversation with Claude — no MCP/tool access, no model picker, no
 * dragging other widgets in as context. Those are explicitly future work; this
 * is deliberately just a chat box talking to one API route.
 */
export function ChatWidget({ instanceId, title }: WidgetProps): JSX.Element {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const load = async () => {
    try {
      const response = await fetch(`/api/instances/${instanceId}/chat`, { cache: 'no-store' });
      if (!response.ok) {
        setError(`HTTP ${response.status}`);
        return;
      }
      const body = (await response.json()) as { messages: ChatMessage[] };
      setMessages(body.messages);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Mount/instance-change fetch — same legitimate case as useWidgetData.ts's
    // initial fetch (every setState in load() happens after an await).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instanceId]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages]);

  const send = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text || sending) return;

    setSending(true);
    setError(null);
    // Optimistic: show the user's own message immediately, replaced by the
    // server's copy (with the assistant reply appended) once it answers.
    setMessages((current) => [...current, { role: 'user', content: text, createdAt: new Date().toISOString() }]);
    setDraft('');

    try {
      const response = await fetch(`/api/instances/${instanceId}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
      });

      const body = (await response.json().catch(() => ({}))) as { messages?: ChatMessage[]; error?: string };

      if (!response.ok || !body.messages) {
        setError(body.error ?? `HTTP ${response.status}`);
        return;
      }

      setMessages(body.messages);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSending(false);
    }
  };

  const clear = async () => {
    try {
      const response = await fetch(`/api/instances/${instanceId}/chat`, { method: 'DELETE' });
      if (response.ok) setMessages([]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  return (
    <WidgetShell
      title={title}
      status="ok"
      settings={{
        geral: (
          <SettingsSection title={strings.widgetSettings.pageGeneral}>
            <ClearConversationRow disabled={messages.length === 0} onClear={() => void clear()} />
          </SettingsSection>
        ),
        estilo: (
          <SettingsSection title={strings.widgetSettings.pageStyle}>
            <ChatColorRow />
          </SettingsSection>
        ),
      }}
    >
      <div className="eve-chat">
        <div className="eve-chat__list eve-no-drag" ref={listRef}>
          {!loading && messages.length === 0 && <p className="eve-dim">{strings.chat.empty}</p>}

          {messages.map((message, index) => (
            <div
              key={index}
              className={message.role === 'user' ? 'eve-chat__bubble is-user' : 'eve-chat__bubble is-assistant'}
            >
              {linkify(message.content)}
            </div>
          ))}
        </div>

        {error && <p className="eve-alert eve-alert--error">{error}</p>}

        <form className="eve-chat__form eve-no-drag" onSubmit={(event) => void send(event)}>
          <input
            className="eve-input"
            placeholder={strings.chat.placeholder}
            value={draft}
            disabled={sending}
            onChange={(event) => setDraft(event.target.value)}
          />
          <button type="submit" className="eve-btn eve-btn--primary" disabled={sending || !draft.trim()}>
            {sending ? strings.chat.sending : strings.chat.send}
          </button>
        </form>
      </div>
    </WidgetShell>
  );
}

/** Clearing wipes the whole history, so it asks once, inline. */
function ClearConversationRow({ disabled, onClear }: { disabled: boolean; onClear: () => void }): JSX.Element {
  const [confirming, setConfirming] = useState(false);

  return (
    <SettingsRow label={strings.chat.clear} hint={confirming ? strings.chat.clearConfirm : strings.chat.clearHint}>
      {confirming ? (
        <>
          <button type="button" className="eve-btn" onClick={() => setConfirming(false)}>
            {strings.widgetSettings.cancel}
          </button>
          <button
            type="button"
            className="eve-btn eve-btn--danger-solid"
            autoFocus
            onClick={() => {
              setConfirming(false);
              onClear();
            }}
          >
            {strings.chat.clearYes}
          </button>
        </>
      ) : (
        <button type="button" className="eve-btn eve-btn--danger" disabled={disabled} onClick={() => setConfirming(true)}>
          {strings.chat.clear}
        </button>
      )}
    </SettingsRow>
  );
}

/** Placeholder: the chat colour is planned, not built — shown disabled so the page has its shape. */
function ChatColorRow(): JSX.Element {
  const id = useId();
  return (
    <SettingsRow label={strings.chat.colorLabel} hint={strings.chat.colorHint} htmlFor={id} badge={<DevBadge />}>
      <input id={id} type="color" className="eve-color-input" defaultValue="#fa5300" disabled />
    </SettingsRow>
  );
}
