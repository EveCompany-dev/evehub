'use client';

import { useEffect, useState, type JSX, type ReactNode } from 'react';
import { strings } from './strings';

export interface UndoBannerProps {
  /** Muda quando surge uma edicao nova — reabre o aviso. */
  editId: string;
  field?: string;
  newValue?: string;
  /** Texto livre no lugar de "campo → valor" (ex.: "Tarefa excluida"). */
  message?: ReactNode;
  userName?: string | null;
  onUndo: () => void;
  /** Tempo ate sumir sozinho. A edicao continua desfazivel pelo menu. */
  autoHideMs?: number;
}

/**
 * Aviso de "editado — desfazer?".
 *
 * Some sozinho depois de alguns segundos e tem X para fechar na hora. Sumir
 * NAO cancela o desfazer: a janela continua sendo de 10 minutos e a acao fica
 * no menu de 3 pontinhos do widget. O aviso e so o atalho imediato.
 */
export function UndoBanner({
  editId,
  field,
  newValue,
  message,
  userName,
  onUndo,
  autoHideMs = 12_000,
}: UndoBannerProps): JSX.Element | null {
  // Guarda QUAL edicao foi dispensada, em vez de um booleano: assim uma edicao
  // nova reabre o aviso sozinha, sem precisar de um efeito so para resetar.
  const [dismissedId, setDismissedId] = useState<string | null>(null);
  const visible = dismissedId !== editId;

  useEffect(() => {
    const timer = setTimeout(() => setDismissedId(editId), autoHideMs);
    return () => clearTimeout(timer);
  }, [editId, autoHideMs]);

  if (!visible) return null;

  return (
    <div className="eve-alert eve-undo">
      <span className="eve-undo__text">
        {message ?? (
          <>
            {field} &rarr; {newValue || '—'}
          </>
        )}
        {userName ? ` (${strings.edit.savedBy(userName)})` : ''}
      </span>

      <span className="eve-undo__actions">
        <button type="button" className="eve-btn eve-no-drag" onClick={onUndo}>
          {strings.edit.undo}
        </button>
        <button
          type="button"
          className="eve-btn eve-btn--icon eve-no-drag"
          aria-label={strings.edit.dismiss}
          title={strings.edit.dismiss}
          onClick={() => setDismissedId(editId)}
        >
          &#10005;
        </button>
      </span>
    </div>
  );
}
