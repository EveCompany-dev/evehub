'use client';

import { useRef, useState, type DragEvent, type JSX } from 'react';

export interface ImageDropZoneProps {
  value: string | null;
  onChange: (url: string | null) => void;
  /** POST target; receives a multipart 'file' field, must respond with `{ url }` on success. */
  endpoint: string;
  accept?: string;
  dropHint: string;
  uploadingHint: string;
  removeLabel: string;
  /** 'round' for avatars, 'rect' (default) for backgrounds/media. */
  shape?: 'round' | 'rect';
}

/**
 * Drag-and-drop / click-to-choose image upload, shared by every image input
 * in the app (dashboard background, profile picture, post media, ...) so
 * they all look and behave the same way instead of each screen inventing its
 * own upload widget. Mirrors the pattern that was originally built just for
 * the dashboard background (see globals.css .eve-upload-drop).
 */
export function ImageDropZone({
  value,
  onChange,
  endpoint,
  accept = 'image/png,image/jpeg,image/webp,image/gif',
  dropHint,
  uploadingHint,
  removeLabel,
  shape = 'rect',
}: ImageDropZoneProps): JSX.Element {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const upload = async (file: File) => {
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const response = await fetch(endpoint, { method: 'POST', body: form });
      const body = (await response.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!response.ok || !body.url) {
        setError(body.error ?? `HTTP ${response.status}`);
        return;
      }
      onChange(body.url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setUploading(false);
    }
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragOver(false);
    const file = event.dataTransfer.files[0];
    if (file) void upload(file);
  };

  return (
    <div>
      <div
        className={
          dragOver
            ? `eve-upload-drop is-drag-over${shape === 'round' ? ' eve-upload-drop--round' : ''}`
            : `eve-upload-drop${shape === 'round' ? ' eve-upload-drop--round' : ''}`
        }
        onClick={() => fileInputRef.current?.click()}
        onDragOver={(event) => {
          event.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
      >
        {value ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="eve-upload-drop__preview" src={value} alt="" />
        ) : (
          <span className="eve-dim">{uploading ? uploadingHint : dropHint}</span>
        )}
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept={accept}
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void upload(file);
          event.target.value = '';
        }}
      />
      {value && (
        <button type="button" className="eve-btn" onClick={() => onChange(null)}>
          {removeLabel}
        </button>
      )}
      {error && <p className="eve-alert eve-alert--error">{error}</p>}
    </div>
  );
}
