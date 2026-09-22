'use client';

import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { mediaKindFromUrl } from '@eve/connector-meta/shared';
import { useRef, useState, type DragEvent, type JSX } from 'react';
import { X } from '@eve/ui';

export interface CarouselDropZoneProps {
  /** Ordered media URLs — index 0 is the first slide. */
  value: string[];
  onChange: (urls: string[]) => void;
  endpoint: string;
  accept: string;
  max: number;
  dropHint: string;
  uploadingHint: string;
  limitHint: (max: number) => string;
  /**
   * Called instead of uploading when several files arrive but only one fits
   * (max 1) — lets the post composer ask "carrossel ou posts separados?"
   * rather than silently keeping the first file.
   */
  onManyFiles?: (files: File[]) => void;
  /** Shown in place of the drop hint while the parent uploads on this zone's behalf. */
  busyHint?: string | null;
}

/** Uploads one file to an upload endpoint and returns its public URL; throws with the server's message. */
export async function uploadMedia(endpoint: string, file: File): Promise<string> {
  const form = new FormData();
  form.append('file', file);
  const response = await fetch(endpoint, { method: 'POST', body: form });
  const body = (await response.json().catch(() => ({}))) as { url?: string; error?: string };
  if (!response.ok || !body.url) throw new Error(body.error ?? `HTTP ${response.status}`);
  return body.url;
}

interface SlideProps {
  url: string;
  index: number;
  showIndex: boolean;
  onRemove: () => void;
}

function Slide({ url, index, showIndex, onRemove }: SlideProps): JSX.Element {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: url });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} className="eve-carousel__slide" {...attributes} {...listeners}>
      {mediaKindFromUrl(url) === 'video' ? (
        <video className="eve-carousel__thumb" src={url} muted loop autoPlay playsInline />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="eve-carousel__thumb" src={url} alt={`Slide ${index + 1}`} />
      )}
      {showIndex && <span className="eve-carousel__index">{index + 1}</span>}
      <button
        type="button"
        className="eve-carousel__remove"
        title="Remover"
        // dnd-kit's listeners are on the whole card (drag handle = the card
        // itself, there's no separate grip) — without this the pointerdown
        // that should just click Remove gets read as the start of a drag.
        onPointerDown={(event) => event.stopPropagation()}
        onClick={onRemove}
      >
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  );
}

/**
 * Multi-image drag-drop/click-to-choose upload with reordering, for
 * Instagram carousel posts (2-10 slides). Deliberately a separate component
 * from ImageDropZone rather than a variant of it: single-media upload and
 * ordered multi-media upload have little in common beyond "drop a file
 * here" — reordering, per-slide remove, and the running-count-vs-max hint
 * have no equivalent in the single case.
 */
export function CarouselDropZone({
  value,
  onChange,
  endpoint,
  accept,
  max,
  dropHint,
  uploadingHint,
  limitHint,
  onManyFiles,
  busyHint,
}: CarouselDropZoneProps): JSX.Element {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const remaining = max - value.length;

  const uploadOne = async (file: File): Promise<string | null> => {
    try {
      return await uploadMedia(endpoint, file);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      return null;
    }
  };

  const uploadMany = async (files: File[]) => {
    if (files.length === 0) return;
    if (onManyFiles && max === 1 && files.length > 1) {
      setError(null);
      onManyFiles(files);
      return;
    }
    setUploading(true);
    setError(null);
    try {
      // Sequential, not Promise.all: preserves drop order (parallel uploads
      // finish in whatever order the network hands them back) and the count
      // this uploader itself has to enforce is small enough that the
      // slowdown never matters.
      const accepted = files.slice(0, remaining);
      if (files.length > accepted.length) setError(limitHint(max));

      const urls: string[] = [];
      for (const file of accepted) {
        const url = await uploadOne(file);
        if (url) urls.push(url);
      }
      if (urls.length > 0) onChange([...value, ...urls]);
    } finally {
      setUploading(false);
    }
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragOver(false);
    void uploadMany([...event.dataTransfer.files]);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = value.indexOf(String(active.id));
    const to = value.indexOf(String(over.id));
    if (from === -1 || to === -1) return;
    onChange(arrayMove(value, from, to));
  };

  return (
    <div className="eve-carousel">
      {value.length > 0 && (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={value} strategy={horizontalListSortingStrategy}>
            <div className="eve-carousel__slides">
              {value.map((url, index) => (
                <Slide
                  key={url}
                  url={url}
                  index={index}
                  showIndex={value.length > 1}
                  onRemove={() => onChange(value.filter((item) => item !== url))}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      {remaining > 0 && (
        <div
          className={dragOver ? 'eve-upload-drop is-drag-over' : 'eve-upload-drop'}
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(event) => {
            event.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
        >
          <span className="eve-dim">{busyHint ?? (uploading ? uploadingHint : dropHint)}</span>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept={accept}
        multiple
        hidden
        onChange={(event) => {
          void uploadMany([...(event.target.files ?? [])]);
          event.target.value = '';
        }}
      />

      <span className="eve-setup__hint">
        {value.length}/{max} — arraste para reordenar
      </span>
      {error && <p className="eve-alert eve-alert--error">{error}</p>}
    </div>
  );
}
