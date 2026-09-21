'use client';

import { ImageIcon, Trash2 } from '@eve/ui';
import { useRef, useState, type JSX } from 'react';
import { Popover } from './Popover';

export interface ImageCellProps {
  value: unknown;
  save: (next: unknown) => Promise<void>;
  variant: 'grid' | 'form';
}

/**
 * An "Imagem" cell: the picture itself as a thumbnail; click to replace it by
 * uploading a file or pasting an image link. This is what gallery cards use
 * as their cover, so the art of a post is a click away instead of a link.
 */
export function ImageCell({ value, save, variant }: ImageCellProps): JSX.Element {
  const url = typeof value === 'string' && value.trim() !== '' ? value : null;
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trigger = useRef<HTMLSpanElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const upload = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const response = await fetch('/api/uploads/table-image', { method: 'POST', body: form });
      const body = (await response.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!response.ok || !body.url) {
        setError(body.error ?? `HTTP ${response.status}`);
        return;
      }
      await save(body.url);
      setAnchor(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const size = variant === 'form' ? 120 : 40;

  return (
    <>
      <span
        ref={trigger}
        role="button"
        tabIndex={0}
        className={variant === 'form' ? 'eve-cell eve-cell--form' : 'eve-cell'}
        onClick={() => trigger.current && setAnchor(trigger.current.getBoundingClientRect())}
        onKeyDown={(event) => event.key === 'Enter' && trigger.current && setAnchor(trigger.current.getBoundingClientRect())}
      >
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element -- user-supplied or uploaded picture of any origin
          <img className="eve-imagecell__thumb" src={url} alt="" style={{ maxHeight: size, maxWidth: size * 2 }} referrerPolicy="no-referrer" />
        ) : (
          <span className="eve-dim eve-imagecell__empty">
            <ImageIcon size={14} aria-hidden="true" /> Adicionar
          </span>
        )}
      </span>

      {anchor && (
        <Popover anchor={anchor} onClose={() => setAnchor(null)} width={280}>
          <p className="eve-popover__title">Imagem</p>
          {error && <p className="eve-alert eve-alert--error">{error}</p>}
          <button type="button" className="eve-btn" disabled={busy} onClick={() => fileInput.current?.click()}>
            {busy ? 'Enviando…' : 'Enviar arquivo'}
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file) void upload(file);
            }}
          />
          <input
            className="eve-input"
            placeholder="ou cole o link de uma imagem…"
            value={link}
            onChange={(event) => setLink(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' || !/^https?:\/\//i.test(link.trim())) return;
              void save(link.trim()).then(() => {
                setLink('');
                setAnchor(null);
              });
            }}
          />
          {url && (
            <button
              type="button"
              className="eve-popover__clear"
              onClick={() => {
                void save(null);
                setAnchor(null);
              }}
            >
              <Trash2 size={13} aria-hidden="true" /> Remover imagem
            </button>
          )}
        </Popover>
      )}
    </>
  );
}
