'use client';

import { useRef, useState, type ChangeEvent, type JSX } from 'react';
import { Bug, X } from '@eve/ui';

interface PendingAttachment {
  id: string;
  filename: string;
  url: string;
  size: number;
}

function BugIcon(): JSX.Element {
  return <Bug size={16} aria-hidden="true" />;
}

/**
 * Fixed pill in the bottom-left corner of every page — bug icon, hides its
 * label until hovered (the "pulled out" slide). Clicking opens the report
 * form; sending it saves the report first, then tells jose@evecompany.com.br
 * in the bell and, once SMTP_URL is set, by e-mail (see lib/bug-report-email.ts),
 * so a report is never lost.
 */
export function BugReportPill(): JSX.Element {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState<PendingAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const close = () => {
    setOpen(false);
    setMessage('');
    setPending([]);
    setError(null);
    setSent(false);
  };

  const uploadFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (!files.length) return;
    setUploading(true);
    setError(null);
    try {
      for (const file of files) {
        const form = new FormData();
        form.append('file', file);
        const response = await fetch('/api/uploads/bug-reports', { method: 'POST', body: form });
        const body = (await response.json().catch(() => ({}))) as { url?: string; filename?: string; size?: number; error?: string };
        if (!response.ok || !body.url) {
          setError(body.error ?? `HTTP ${response.status}`);
          continue;
        }
        setPending((current) => [
          ...current,
          { id: crypto.randomUUID(), filename: body.filename ?? file.name, url: body.url!, size: body.size ?? file.size },
        ]);
      }
    } finally {
      setUploading(false);
    }
  };

  const removePending = (id: string) => {
    setPending((current) => current.filter((attachment) => attachment.id !== id));
  };

  const submit = async () => {
    if (!message.trim()) {
      setError('Descreva o que aconteceu.');
      return;
    }
    setSending(true);
    setError(null);
    try {
      const response = await fetch('/api/bug-reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: message.trim(),
          attachments: pending.map(({ filename, url, size }) => ({ filename, url, size })),
        }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? `HTTP ${response.status}`);
        return;
      }
      setSent(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <button type="button" className="eve-bugpill" onClick={() => setOpen(true)}>
        {/* Label before icon in the DOM: the slide (see .eve-bugpill's transform)
            moves the whole box left, so whatever sits at its trailing (right) edge
            is what stays on screen at rest — that has to be the icon, not the
            label, or its tail end peeks out instead. */}
        <span className="eve-bugpill__label">Reportar bug/feedback</span>
        <span className="eve-bugpill__icon">
          <BugIcon />
        </span>
      </button>

      {open && (
        <div className="eve-modal-backdrop" onClick={close}>
          <div className="eve-modal eve-bugreport-modal" onClick={(event) => event.stopPropagation()}>
            {sent ? (
              <>
                <h2 className="eve-card__title">Obrigado!</h2>
                <p className="eve-dim">Seu relato foi enviado. A equipe vai dar uma olhada.</p>
                <div className="eve-profile__actions">
                  <button type="button" className="eve-btn eve-btn--primary" onClick={close}>
                    Fechar
                  </button>
                </div>
              </>
            ) : (
              <>
                <h2 className="eve-card__title">Reportar bug/feedback</h2>

                {error && <p className="eve-alert eve-alert--error">{error}</p>}

                <label className="eve-field">
                  <span className="eve-field__label">O que aconteceu?</span>
                  <textarea
                    className="eve-input eve-notes__textarea"
                    rows={5}
                    placeholder="Descreva o problema ou dê o seu feedback!"
                    value={message}
                    onChange={(event) => setMessage(event.target.value)}
                    autoFocus
                  />
                </label>

                {pending.length > 0 && (
                  <ul className="eve-chat-workspace__pending">
                    {pending.map((attachment) => (
                      <li key={attachment.id} className="eve-chat-workspace__pending-item">
                        <span>{attachment.filename}</span>
                        <button type="button" className="eve-btn eve-btn--icon" onClick={() => removePending(attachment.id)}>
                          <X size={14} aria-hidden="true" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}

                <input ref={fileInputRef} type="file" accept="image/*" multiple hidden onChange={(event) => void uploadFiles(event)} />

                <div className="eve-profile__actions">
                  <button type="button" className="eve-btn" disabled={uploading} onClick={() => fileInputRef.current?.click()}>
                    {uploading ? 'Enviando imagem...' : 'Anexar imagem'}
                  </button>
                  <button type="button" className="eve-btn eve-btn--primary" disabled={sending || uploading} onClick={() => void submit()}>
                    {sending ? 'Enviando...' : 'Enviar'}
                  </button>
                  <button type="button" className="eve-btn" onClick={close} disabled={sending}>
                    Cancelar
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
