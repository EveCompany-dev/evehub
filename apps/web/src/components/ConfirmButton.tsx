'use client';

import { useEffect, useRef, useState, type JSX, type ReactNode } from 'react';

export interface ConfirmButtonProps {
  /** Resting label — text, or an icon for a row action. */
  children: ReactNode;
  /** What the armed button says. Make it name the act: "Apagar mesmo", not "Sim". */
  confirmLabel: string;
  /** Shown beside the armed buttons. Use it to state what is lost, not to repeat the label. */
  question?: string;
  onConfirm: () => void;
  disabled?: boolean;
  /** Classes for the resting button. The armed pair is always danger + plain. */
  className?: string;
  title?: string;
  ariaLabel?: string;
}

/**
 * A destructive action that asks first, in the app.
 *
 * `window.confirm` is deliberately not used anywhere: it is a browser chrome
 * dialog, so it cannot say what the action actually costs in the app's own
 * words or styling, it blocks the whole tab, and on some setups it is
 * suppressed entirely — which turns "are you sure?" into a silent delete.
 *
 * Two clicks in place instead, the pattern TeamSection already used for
 * removing a member. Arming disarms on Escape or on Cancel, and never leaves
 * an armed button behind when the row it belongs to goes away.
 */
export function ConfirmButton({
  children,
  confirmLabel,
  question,
  onConfirm,
  disabled = false,
  className = 'eve-btn eve-btn--danger',
  title,
  ariaLabel,
}: ConfirmButtonProps): JSX.Element {
  const [armed, setArmed] = useState(false);
  const confirmRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!armed) return;
    // Focus the confirm step so it is reachable by keyboard, and let Escape
    // back out the same way it would from a dialog.
    confirmRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      // Stop here: an armed confirm inside a modal should disarm, not close
      // the modal behind it.
      event.stopPropagation();
      setArmed(false);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [armed]);

  if (!armed) {
    return (
      <button type="button" className={className} disabled={disabled} title={title} aria-label={ariaLabel} onClick={() => setArmed(true)}>
        {children}
      </button>
    );
  }

  return (
    <>
      {question && <span className="eve-dim">{question}</span>}
      <button
        ref={confirmRef}
        type="button"
        className="eve-btn eve-btn--danger"
        disabled={disabled}
        onClick={() => {
          setArmed(false);
          onConfirm();
        }}
      >
        {confirmLabel}
      </button>
      <button type="button" className="eve-btn" disabled={disabled} onClick={() => setArmed(false)}>
        Cancelar
      </button>
    </>
  );
}
