'use client';

import { EmojiPicker } from './EmojiPicker';
import { linkify } from './Linkify';
import type { DirectConversationSummary, DirectMessageAttachmentSummary, DirectMessageSummary } from './direct-chat-types';
import { formatDateTimePtBr, memberInitials, memberLabel, type JobMember } from './job-types';
import { renderRichText } from './RichText';
import { useFormattingToolbar } from './useFormattingToolbar';
import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import { Paperclip, Smile, X } from '@eve/ui';

export interface DirectChatWorkspaceProps {
  currentUserId: string;
}

const POLL_INTERVAL_MS = 6000;
const NEAR_BOTTOM_PX = 80;

function PaperclipIcon(): JSX.Element {
  return <Paperclip size={14} aria-hidden="true" />;
}

function EmojiIcon(): JSX.Element {
  return <Smile size={16} aria-hidden="true" />;
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size}B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)}KB`;
  return `${(size / 1024 / 1024).toFixed(1)}MB`;
}

/**
 * Private 1:1 chat — same functionality as the team chat (attachments,
 * emoji, rich text, polling) minus @mentions, which don't mean anything in a
 * two-person conversation where the recipient is already the only other
 * person there. Own component rather than a mode flag on TeamChatWorkspace:
 * the data shape (a conversation list + per-conversation thread) is
 * different enough that threading it through one component would mean an
 * `isDirect` branch through nearly every function in it.
 */
export function DirectChatWorkspace({ currentUserId }: DirectChatWorkspaceProps): JSX.Element {
  const [conversations, setConversations] = useState<DirectConversationSummary[]>([]);
  const [members, setMembers] = useState<JobMember[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<DirectMessageSummary[]>([]);
  const [loadingConversations, setLoadingConversations] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [draft, setDraft] = useState('');
  const [pendingAttachments, setPendingAttachments] = useState<DirectMessageAttachmentSummary[]>([]);
  const [uploading, setUploading] = useState(false);
  const [sending, setSending] = useState(false);
  const [showEmoji, setShowEmoji] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const listRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const emojiRef = useRef<HTMLDivElement>(null);
  const { textareaRef: formatRef, toolbar: formatToolbar } = useFormattingToolbar(draft, setDraft);

  const loadConversations = useCallback(async () => {
    try {
      const response = await fetch('/api/direct-messages/conversations', { cache: 'no-store' });
      const body = (await response.json().catch(() => ({}))) as { conversations?: DirectConversationSummary[]; error?: string };
      if (!response.ok || !body.conversations) {
        setError(body.error ?? `HTTP ${response.status}`);
        return;
      }
      setConversations(body.conversations);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoadingConversations(false);
    }
  }, []);

  const loadMessages = useCallback(async (conversationId: string) => {
    try {
      const response = await fetch(`/api/direct-messages/conversations/${conversationId}/messages`, { cache: 'no-store' });
      const body = (await response.json().catch(() => ({}))) as { messages?: DirectMessageSummary[]; error?: string };
      if (!response.ok || !body.messages) {
        setError(body.error ?? `HTTP ${response.status}`);
        return;
      }
      setMessages(body.messages);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  useEffect(() => {
    // Mount fetch — same legitimate case as useWidgetData.ts's initial fetch.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadConversations();
    const interval = setInterval(() => void loadConversations(), POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [loadConversations]);

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch('/api/workspace/members', { cache: 'no-store' });
        const body = (await response.json().catch(() => ({}))) as { members?: JobMember[] };
        if (response.ok && body.members) setMembers(body.members.filter((member) => member.id !== currentUserId));
      } catch {
        // Non-critical: the "start a conversation" list just stays empty.
      }
    })();
  }, [currentUserId]);

  useEffect(() => {
    if (!activeId) return;
    setLoadingMessages(true);
    void loadMessages(activeId).finally(() => setLoadingMessages(false));
    const interval = setInterval(() => void loadMessages(activeId), POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [activeId, loadMessages]);

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

  const startConversation = async (userId: string) => {
    setError(null);
    try {
      const response = await fetch('/api/direct-messages/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      });
      const body = (await response.json().catch(() => ({}))) as { conversation?: DirectConversationSummary; error?: string };
      if (!response.ok || !body.conversation) {
        setError(body.error ?? `HTTP ${response.status}`);
        return;
      }
      setConversations((current) => (current.some((item) => item.id === body.conversation!.id) ? current : [body.conversation!, ...current]));
      setActiveId(body.conversation.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const uploadFiles = async (files: File[]) => {
    if (!files.length) return;
    setUploading(true);
    setError(null);
    try {
      for (const file of files) {
        const form = new FormData();
        form.append('file', file);
        const response = await fetch('/api/uploads/direct-chat', { method: 'POST', body: form });
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
    if (!activeId || (!draft.trim() && pendingAttachments.length === 0)) return;
    setSending(true);
    setError(null);
    try {
      const response = await fetch(`/api/direct-messages/conversations/${activeId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          body: draft.trim() || '(anexo)',
          attachments: pendingAttachments.map(({ filename, url, size }) => ({ filename, url, size })),
        }),
      });
      const body = (await response.json().catch(() => ({}))) as { message?: DirectMessageSummary; error?: string };
      if (!response.ok || !body.message) {
        setError(body.error ?? `HTTP ${response.status}`);
        return;
      }
      const message = body.message;
      setMessages((current) => [...current, message]);
      setConversations((current) =>
        current.map((item) => (item.id === activeId ? { ...item, lastMessage: { body: message.body, createdAt: message.createdAt } } : item)),
      );
      setDraft('');
      setPendingAttachments([]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSending(false);
    }
  };

  const deleteMessage = async (id: string) => {
    if (!activeId) return;
    setError(null);
    try {
      const response = await fetch(`/api/direct-messages/conversations/${activeId}/messages/${id}`, { method: 'DELETE' });
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

  const conversationMemberIds = new Set(conversations.map((conversation) => conversation.otherUser.id));
  const startableMembers = members.filter((member) => !conversationMemberIds.has(member.id));
  const active = conversations.find((conversation) => conversation.id === activeId) ?? null;

  return (
    <div className="eve-dm-workspace">
      <div className="eve-dm-workspace__sidebar">
        {loadingConversations ? (
          <p className="eve-dim">carregando...</p>
        ) : conversations.length === 0 && startableMembers.length === 0 ? (
          <p className="eve-dim">Nenhum outro membro na equipe ainda.</p>
        ) : (
          <>
            {conversations.map((conversation) => (
              <button
                key={conversation.id}
                type="button"
                className={conversation.id === activeId ? 'eve-dm-workspace__conversation is-active' : 'eve-dm-workspace__conversation'}
                onClick={() => setActiveId(conversation.id)}
              >
                <span className="eve-avatar eve-avatar--fallback" style={{ width: 32, height: 32, fontSize: 12 }}>
                  {memberInitials(conversation.otherUser)}
                </span>
                <span className="eve-dm-workspace__conversation-text">
                  <span className="eve-dm-workspace__conversation-name">{memberLabel(conversation.otherUser)}</span>
                  <span className="eve-dim eve-dm-workspace__conversation-preview">
                    {conversation.lastMessage?.body ?? 'Nenhuma mensagem ainda'}
                  </span>
                </span>
              </button>
            ))}

            {startableMembers.length > 0 && (
              <>
                <span className="eve-dm-workspace__sidebar-label">Iniciar conversa</span>
                {startableMembers.map((member) => (
                  <button
                    key={member.id}
                    type="button"
                    className="eve-dm-workspace__conversation"
                    onClick={() => void startConversation(member.id)}
                  >
                    <span className="eve-avatar eve-avatar--fallback" style={{ width: 32, height: 32, fontSize: 12 }}>
                      {memberInitials(member)}
                    </span>
                    <span className="eve-dm-workspace__conversation-text">
                      <span className="eve-dm-workspace__conversation-name">{memberLabel(member)}</span>
                    </span>
                  </button>
                ))}
              </>
            )}
          </>
        )}
      </div>

      <div className="eve-dm-workspace__thread">
        {error && <p className="eve-alert eve-alert--error">{error}</p>}

        {!active ? (
          <div className="eve-empty">
            <p className="eve-dim">Escolha alguém para conversar em particular.</p>
          </div>
        ) : (
          <>
            <div className="eve-dm-workspace__thread-head">
              <span className="eve-avatar eve-avatar--fallback" style={{ width: 28, height: 28, fontSize: 11 }}>
                {memberInitials(active.otherUser)}
              </span>
              <span className="eve-dm-workspace__conversation-name">{memberLabel(active.otherUser)}</span>
            </div>

            <div className="eve-chat-workspace__list" ref={listRef}>
              {loadingMessages ? (
                <p className="eve-dim">carregando...</p>
              ) : messages.length === 0 ? (
                <div className="eve-empty">
                  <p className="eve-dim">Nenhuma mensagem ainda — diga oi.</p>
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
                      <div className="eve-chat-workspace__message-text">{renderRichText(message.body, linkify)}</div>
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
                        <X size={14} aria-hidden="true" />
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
                      <X size={14} aria-hidden="true" />
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
              <textarea
                ref={(node) => {
                  textareaRef.current = node;
                  formatRef.current = node;
                }}
                className="eve-input eve-chat-workspace__input"
                rows={2}
                placeholder={`Mensagem para ${memberLabel(active.otherUser)}`}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
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
          </>
        )}
      </div>
    </div>
  );
}
