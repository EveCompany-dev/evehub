'use client';

import { EmojiPicker } from './EmojiPicker';
import { linkify } from './Linkify';
import { formatDateTimePtBr, memberInitials, memberLabel, type JobMember } from './job-types';
import { renderRichText } from './RichText';
import type { TeamMessageAttachmentSummary, TeamMessageSummary } from './team-chat-types';
import { useFormattingToolbar } from './useFormattingToolbar';
import {
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type JSX,
  type ReactNode,
} from 'react';

export interface TeamChatWorkspaceProps {
  currentUserId: string;
}

const POLL_INTERVAL_MS = 6000;
const NEAR_BOTTOM_PX = 80;

function PaperclipIcon(): JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M8 12.5 15 5.5a3 3 0 0 1 4.2 4.2l-8.5 8.5a5 5 0 1 1-7-7l7.5-7.5"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function EmojiIcon(): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="9" cy="10" r="1" fill="currentColor" />
      <circle cx="15" cy="10" r="1" fill="currentColor" />
      <path d="M8.5 14.5c1 1.3 2.2 2 3.5 2s2.5-.7 3.5-2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size}B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)}KB`;
  return `${(size / 1024 / 1024).toFixed(1)}MB`;
}

/**
 * Leaf-level highlighter passed into renderRichText() as `extra`: splits on
 * known member names first (as @mentions), then linkifies whatever's left
 * over so URLs/file paths still work inside message text that also mentions
 * someone — same composition pattern as the job description's client-name
 * highlighting.
 */
function highlightMentions(text: string, members: JobMember[]): ReactNode[] {
  const named = members.filter((member) => member.name?.trim());
  if (!named.length) return linkify(text);

  const pattern = new RegExp(
    `(@(?:${[...named]
      .sort((a, b) => (b.name?.length ?? 0) - (a.name?.length ?? 0))
      .map((member) => member.name!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('|')}))`,
    'g',
  );
  const segments = text.split(pattern);
  const nodes: ReactNode[] = [];

  segments.forEach((segment, index) => {
    if (!segment) return;
    if (segment.startsWith('@') && named.some((member) => `@${member.name}` === segment)) {
      nodes.push(
        <span key={`mention-${index}`} className="eve-chat__mention">
          {segment}
        </span>,
      );
      return;
    }
    linkify(segment).forEach((node, subIndex) => {
      nodes.push(isValidElement(node) ? cloneElement(node, { key: `text-${index}-${subIndex}` }) : node);
    });
  });

  return nodes;
}

export function TeamChatWorkspace({ currentUserId }: TeamChatWorkspaceProps): JSX.Element {
  const [messages, setMessages] = useState<TeamMessageSummary[]>([]);
  const [members, setMembers] = useState<JobMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [draft, setDraft] = useState('');
  const [pendingAttachments, setPendingAttachments] = useState<TeamMessageAttachmentSummary[]>([]);
  const [mentionedUserIds, setMentionedUserIds] = useState<Set<string>>(new Set());
  const [uploading, setUploading] = useState(false);
  const [sending, setSending] = useState(false);
  const [showEmoji, setShowEmoji] = useState(false);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const listRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const emojiRef = useRef<HTMLDivElement>(null);
  // Formatting toolbar needs its own ref to read selectionStart/End — merged
  // onto the same <textarea> as the component's own ref (mention/emoji
  // cursor tracking) below.
  const { textareaRef: formatRef, toolbar: formatToolbar } = useFormattingToolbar(draft, setDraft);

  const loadMessages = useCallback(async () => {
    try {
      const response = await fetch('/api/team-chat/messages', { cache: 'no-store' });
      const body = (await response.json().catch(() => ({}))) as { messages?: TeamMessageSummary[]; error?: string };
      if (!response.ok || !body.messages) {
        setError(body.error ?? `HTTP ${response.status}`);
        return;
      }
      setMessages(body.messages);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Mount fetch — same legitimate case as useWidgetData.ts's initial fetch.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadMessages();
    const interval = setInterval(() => void loadMessages(), POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [loadMessages]);

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch('/api/workspace/members', { cache: 'no-store' });
        const body = (await response.json().catch(() => ({}))) as { members?: JobMember[] };
        if (response.ok && body.members) setMembers(body.members);
      } catch {
        // Non-critical: @mention autocomplete just won't suggest anyone.
      }
    })();
  }, []);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < NEAR_BOTTOM_PX;
    if (nearBottom) list.scrollTop = list.scrollHeight;
  }, [messages]);

  useEffect(() => {
    if (!showEmoji) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!emojiRef.current?.contains(event.target as Node)) setShowEmoji(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [showEmoji]);

  const insertAtCursor = (text: string) => {
    const textarea = textareaRef.current;
    if (!textarea) {
      setDraft((current) => current + text);
      return;
    }
    const start = textarea.selectionStart ?? draft.length;
    const end = textarea.selectionEnd ?? draft.length;
    const next = draft.slice(0, start) + text + draft.slice(end);
    setDraft(next);
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.selectionStart = textarea.selectionEnd = start + text.length;
    });
  };

  const handleDraftChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    const value = event.target.value;
    setDraft(value);
    const cursor = event.target.selectionStart ?? value.length;
    // [^\s@]* (not \w*) so accented names (João, ...) still filter correctly.
    const match = value.slice(0, cursor).match(/(?:^|\s)@([^\s@]*)$/);
    setMentionQuery(match ? match[1]! : null);
  };

  const selectMention = (member: JobMember) => {
    const cursor = textareaRef.current?.selectionStart ?? draft.length;
    const before = draft.slice(0, cursor);
    const after = draft.slice(cursor);
    const replaced = before.replace(/@([^\s@]*)$/, `@${member.name ?? memberLabel(member)} `);
    setDraft(replaced + after);
    setMentionedUserIds((current) => new Set(current).add(member.id));
    setMentionQuery(null);
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const mentionCandidates =
    mentionQuery === null
      ? []
      : members.filter((member) => memberLabel(member).toLowerCase().includes(mentionQuery.toLowerCase())).slice(0, 6);

  const uploadFiles = async (files: File[]) => {
    if (!files.length) return;
    setUploading(true);
    setError(null);
    try {
      for (const file of files) {
        const form = new FormData();
        form.append('file', file);
        const response = await fetch('/api/uploads/team-chat', { method: 'POST', body: form });
        const body = (await response.json().catch(() => ({}))) as { url?: string; filename?: string; size?: number; error?: string };
        if (!response.ok || !body.url) {
          setError(body.error ?? `HTTP ${response.status}`);
          continue;
        }
        setPendingAttachments((current) => [
          ...current,
          { id: crypto.randomUUID(), filename: body.filename ?? file.name, url: body.url!, size: body.size ?? file.size },
        ]);
      }
    } finally {
      setUploading(false);
    }
  };

  const removePendingAttachment = (id: string) => {
    setPendingAttachments((current) => current.filter((attachment) => attachment.id !== id));
  };

  const sendMessage = async () => {
    if (!draft.trim() && pendingAttachments.length === 0) return;
    setSending(true);
    setError(null);
    try {
      const response = await fetch('/api/team-chat/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          body: draft.trim() || '(anexo)',
          attachments: pendingAttachments.map(({ filename, url, size }) => ({ filename, url, size })),
          mentionedUserIds: [...mentionedUserIds],
        }),
      });
      const body = (await response.json().catch(() => ({}))) as { message?: TeamMessageSummary; error?: string };
      if (!response.ok || !body.message) {
        setError(body.error ?? `HTTP ${response.status}`);
        return;
      }
      const message = body.message;
      setMessages((current) => [...current, message]);
      setDraft('');
      setPendingAttachments([]);
      setMentionedUserIds(new Set());
      setMentionQuery(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSending(false);
    }
  };

  const deleteMessage = async (id: string) => {
    setError(null);
    try {
      const response = await fetch(`/api/team-chat/messages/${id}`, { method: 'DELETE' });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? `HTTP ${response.status}`);
        return;
      }
      setMessages((current) => current.filter((message) => message.id !== id));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  return (
    <div className="eve-chat-workspace">
      {error && <p className="eve-alert eve-alert--error">{error}</p>}

      <div className="eve-chat-workspace__list" ref={listRef}>
        {loading ? (
          <p className="eve-dim">carregando...</p>
        ) : messages.length === 0 ? (
          <div className="eve-empty">
            <p className="eve-dim">Nenhuma mensagem ainda.</p>
            <p className="eve-dim">Seja o primeiro a escrever no chat da equipe.</p>
          </div>
        ) : (
          messages.map((message) => (
            <div key={message.id} className="eve-chat-workspace__message">
              <span className="eve-avatar eve-avatar--fallback" style={{ width: 28, height: 28, fontSize: 11 }}>
                {memberInitials(message.author)}
              </span>
              <div className="eve-chat-workspace__message-body">
                <div className="eve-chat-workspace__message-meta">
                  <span className="eve-chat-workspace__message-author">{memberLabel(message.author)}</span>
                  <span className="eve-dim">{formatDateTimePtBr(message.createdAt)}</span>
                </div>
                <div className="eve-chat-workspace__message-text">
                  {renderRichText(message.body, (segment) => highlightMentions(segment, members))}
                </div>
                {message.attachments.length > 0 && (
                  <ul className="eve-chat-workspace__attachments">
                    {message.attachments.map((attachment) => (
                      <li key={attachment.id} className="eve-chat-workspace__attachment">
                        <PaperclipIcon />
                        <a href={attachment.url} target="_blank" rel="noreferrer">
                          {attachment.filename}
                        </a>
                        <span className="eve-dim">{formatBytes(attachment.size)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              {message.authorId === currentUserId && (
                <button
                  type="button"
                  className="eve-btn eve-btn--icon"
                  title="Apagar mensagem"
                  onClick={() => void deleteMessage(message.id)}
                >
                  ×
                </button>
              )}
            </div>
          ))
        )}
      </div>

      {pendingAttachments.length > 0 && (
        <ul className="eve-chat-workspace__pending">
          {pendingAttachments.map((attachment) => (
            <li key={attachment.id} className="eve-chat-workspace__pending-item">
              <PaperclipIcon />
              <span>{attachment.filename}</span>
              <button type="button" className="eve-btn eve-btn--icon" onClick={() => removePendingAttachment(attachment.id)}>
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      <div
        className={dragOver ? 'eve-chat-workspace__composer is-drag-over' : 'eve-chat-workspace__composer'}
        onDragOver={(event) => {
          if (!event.dataTransfer.types.includes('Files')) return;
          event.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(event) => {
          if (!event.dataTransfer.types.includes('Files')) return;
          event.preventDefault();
          setDragOver(false);
          void uploadFiles([...event.dataTransfer.files]);
        }}
      >
        {mentionCandidates.length > 0 && (
          <ul className="eve-chat-workspace__mentions">
            {mentionCandidates.map((member) => (
              <li key={member.id}>
                <button type="button" onClick={() => selectMention(member)}>
                  {memberLabel(member)}
                </button>
              </li>
            ))}
          </ul>
        )}

        <textarea
          ref={(node) => {
            textareaRef.current = node;
            formatRef.current = node;
          }}
          className="eve-input eve-chat-workspace__input"
          rows={2}
          placeholder="Escreva uma mensagem — @ para mencionar alguém"
          value={draft}
          onChange={handleDraftChange}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              void sendMessage();
            }
          }}
        />
        {formatToolbar}

        <div className="eve-chat-workspace__actions">
          <div className="eve-chat-workspace__emoji" ref={emojiRef}>
            <button type="button" className="eve-btn eve-btn--icon" title="Emoji" onClick={() => setShowEmoji((value) => !value)}>
              <EmojiIcon />
            </button>
            {showEmoji && (
              <EmojiPicker
                onSelect={(emoji) => {
                  insertAtCursor(emoji);
                  setShowEmoji(false);
                }}
              />
            )}
          </div>

          <input
            ref={fileInputRef}
            type="file"
            multiple
            hidden
            onChange={(event) => {
              void uploadFiles([...(event.target.files ?? [])]);
              event.target.value = '';
            }}
          />
          <button
            type="button"
            className="eve-btn eve-btn--icon"
            title="Anexar arquivo"
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
          >
            <PaperclipIcon />
          </button>

          <button type="button" className="eve-btn eve-btn--primary" disabled={sending || uploading} onClick={() => void sendMessage()}>
            Enviar
          </button>
        </div>
      </div>
    </div>
  );
}
