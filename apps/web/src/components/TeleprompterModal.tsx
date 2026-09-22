'use client';

import { useEffect, useRef, useState, type JSX } from 'react';
import { useEscapeToClose } from './useEscapeToClose';
import { Minus, Pause, Play, Plus, RotateCcw, X } from '@eve/ui';

export interface TeleprompterModalProps {
  title: string;
  text: string;
  onClose: () => void;
}

const MIN_SIZE = 20;
const MAX_SIZE = 56;
const MIN_SPEED = 1;
const MAX_SPEED = 5;

/**
 * Full-screen, always-dark reading view for a script/caption ("Roteiro /
 * legenda") — for someone holding a phone while filming, not for editing.
 * Big text, optional auto-scroll, thumb-reachable controls. Editing stays
 * on the row page; this is a read-only lens over the same value.
 */
export function TeleprompterModal({ title, text, onClose }: TeleprompterModalProps): JSX.Element {
  useEscapeToClose(onClose);
  const [fontSize, setFontSize] = useState(32);
  const [speed, setSpeed] = useState(2);
  const [scrolling, setScrolling] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!scrolling) return;
    const el = bodyRef.current;
    if (!el) return;
    let lastTime: number | null = null;
    const pxPerSecond = speed * 18;
    const tick = (time: number) => {
      if (lastTime !== null) {
        const dt = (time - lastTime) / 1000;
        el.scrollTop += pxPerSecond * dt;
        if (el.scrollTop + el.clientHeight >= el.scrollHeight) {
          setScrolling(false);
          return;
        }
      }
      lastTime = time;
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [scrolling, speed]);

  return (
    <div className="eve-teleprompter" role="dialog" aria-label={`Teleprompter: ${title}`}>
      <div className="eve-teleprompter__bar">
        <span className="eve-teleprompter__title">{title}</span>
        <button type="button" className="eve-btn eve-btn--icon eve-teleprompter__close" aria-label="Fechar teleprompter" onClick={onClose}>
          <X size={18} aria-hidden="true" />
        </button>
      </div>

      <div className="eve-teleprompter__body" ref={bodyRef}>
        <p className="eve-teleprompter__text" style={{ fontSize }}>
          {text || <span className="eve-dim">Sem roteiro.</span>}
        </p>
      </div>

      <div className="eve-teleprompter__controls">
        <div className="eve-teleprompter__group" role="group" aria-label="Tamanho do texto">
          <button
            type="button"
            className="eve-btn eve-btn--icon eve-teleprompter__ctrl"
            aria-label="Diminuir texto"
            onClick={() => setFontSize((size) => Math.max(MIN_SIZE, size - 4))}
          >
            <Minus size={16} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="eve-btn eve-btn--icon eve-teleprompter__ctrl"
            aria-label="Aumentar texto"
            onClick={() => setFontSize((size) => Math.min(MAX_SIZE, size + 4))}
          >
            <Plus size={16} aria-hidden="true" />
          </button>
        </div>

        <button
          type="button"
          className="eve-btn eve-btn--primary eve-teleprompter__play"
          onClick={() => setScrolling((value) => !value)}
        >
          {scrolling ? <Pause size={18} aria-hidden="true" /> : <Play size={18} aria-hidden="true" />}
          {scrolling ? 'Pausar' : 'Rolar'}
        </button>

        <div className="eve-teleprompter__group" role="group" aria-label="Velocidade da rolagem">
          <button
            type="button"
            className="eve-btn eve-btn--icon eve-teleprompter__ctrl"
            aria-label="Rolagem mais lenta"
            onClick={() => setSpeed((value) => Math.max(MIN_SPEED, value - 1))}
          >
            <Minus size={16} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="eve-btn eve-btn--icon eve-teleprompter__ctrl"
            aria-label="Voltar ao topo"
            onClick={() => {
              setScrolling(false);
              bodyRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
            }}
          >
            <RotateCcw size={16} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="eve-btn eve-btn--icon eve-teleprompter__ctrl"
            aria-label="Rolagem mais rápida"
            onClick={() => setSpeed((value) => Math.min(MAX_SPEED, value + 1))}
          >
            <Plus size={16} aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}
