'use client';

import { useRef, useState, type ComponentType, type JSX, type ReactNode } from 'react';
import type { LucideProps } from 'lucide-react';
import { formatRelativeTime } from './relative-time';
import { StatusPill, type ConnectorStatusValue } from './StatusPill';
import { strings } from './strings';
import { useNow } from './useNow';
import { EllipsisVertical, Pencil, X } from './icons';
import { useWidgetChrome } from './widget-chrome';
import { visibleSettingsPages, type WidgetSettingsPages } from './widget-settings-pages';
import { WidgetSettingsDialog } from './WidgetSettingsDialog';

/**
 * An item of the old ⋮ dropdown. Still accepted as a fallback while widgets
 * move to `settings`: the items render on the settings card's Geral page.
 */
export interface WidgetAction {
  label: string;
  onSelect: () => void;
  /** Rendered in the brick colour, for destructive actions. */
  danger?: boolean;
  /** Turns the item into a toggle: true/false shows its state, undefined is a plain action. */
  checked?: boolean;
}

export interface WidgetShellProps {
  title: string;
  status: ConnectorStatusValue;
  statusMessage?: string | null;
  lastSyncedAt?: string | null;
  readOnly?: boolean;
  /** @deprecated Pass `settings` (and `onSyncNow`/`onUndoLast`) instead. */
  actions?: WidgetAction[];
  /**
   * The pages of this widget's settings card, opened from the ⋮ button. Pass
   * content for the pages that apply (`geral`, `estilo`, `conexao`); a page
   * left empty is not shown. Lock and "remover do painel" come from the grid
   * (WidgetChromeContext) and need nothing here.
   */
  settings?: WidgetSettingsPages;
  /** Offers "Sincronizar agora" in the card, for widgets backed by a sync. */
  onSyncNow?: () => void | Promise<void>;
  /** Offers "Desfazer ultima edicao" in the card — pass it only while there is something to undo. */
  onUndoLast?: (() => void) | null;
  /** Overrides the grid's remove action, for a shell rendered outside the grid. */
  onRemove?: () => void;
  /** Overrides the icon the grid picked for this widget's connector. */
  icon?: ComponentType<LucideProps>;
  footerExtra?: ReactNode;
  children: ReactNode;

  /**
   * Edicao do widget inteiro, num unico botao no cabecalho.
   *
   * Substitui o lapis por celula: com uma tabela de vinte linhas, vinte lapis
   * viram ruido visual. Passe `editable` para o connector que sabe escrever e
   * o proprio widget alterna suas celulas para inputs.
   */
  editable?: boolean;
  editing?: boolean;
  onToggleEdit?: () => void;
}

/**
 * The common chrome every connector widget sits inside: title, health, the
 * three-dot button that opens the widget's settings card, and the
 * "atualizado ha X min" footer. The connector owns only the body.
 */
export function WidgetShell({
  title,
  status,
  statusMessage,
  lastSyncedAt,
  readOnly = false,
  actions = [],
  settings,
  onSyncNow,
  onUndoLast,
  onRemove,
  icon,
  footerExtra,
  children,
  editable = false,
  editing = false,
  onToggleEdit,
}: WidgetShellProps): JSX.Element {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const chrome = useWidgetChrome();

  // null on the server and on the very first client render, then it ticks.
  const now = useNow();
  const relative = now === null ? null : formatRelativeTime(lastSyncedAt ?? null, now);

  const remove = onRemove ?? chrome.onRemove;
  const hasSettings =
    visibleSettingsPages(settings, actions.length).length > 0 || Boolean(onSyncNow || onUndoLast || remove || chrome.onToggleLock);

  return (
    <section className="eve-widget">
      <header className="eve-widget__header">
        <h3 className="eve-widget__title">{title}</h3>
        <StatusPill status={status} message={statusMessage} />

        {editable && onToggleEdit && (
          <button
            type="button"
            className={editing ? 'eve-btn eve-btn--icon is-active eve-no-drag' : 'eve-btn eve-btn--icon eve-no-drag'}
            aria-pressed={editing}
            title={editing ? strings.edit.cancel : strings.edit.edit}
            aria-label={editing ? strings.edit.cancel : strings.edit.edit}
            onClick={onToggleEdit}
          >
            {editing ? <X size={14} aria-hidden="true" /> : <Pencil size={14} aria-hidden="true" />}
          </button>
        )}

        {hasSettings && (
          // eve-no-drag keeps the grid from treating the click as a drag.
          <div className="eve-widget__menu eve-no-drag">
            <button
              ref={menuButtonRef}
              type="button"
              className={settingsOpen ? 'eve-btn eve-btn--icon is-active' : 'eve-btn eve-btn--icon'}
              aria-haspopup="dialog"
              aria-expanded={settingsOpen}
              aria-label={strings.widgetSettings.open}
              title={strings.widgetSettings.open}
              onClick={() => setSettingsOpen(true)}
            >
              <EllipsisVertical size={14} aria-hidden="true" />
            </button>

            <WidgetSettingsDialog
              open={settingsOpen}
              title={title}
              icon={icon ?? chrome.icon}
              pages={settings}
              legacyActions={actions}
              locked={chrome.locked}
              onToggleLock={chrome.onToggleLock}
              onSyncNow={onSyncNow}
              onUndoLast={onUndoLast}
              onRemove={remove}
              onClose={() => setSettingsOpen(false)}
              returnFocusRef={menuButtonRef}
            />
          </div>
        )}
      </header>

      <div className="eve-widget__body">{children}</div>

      <footer className="eve-widget__footer">
        <span>
          {now === null
            ? '—'
            : status === 'syncing'
              ? strings.widget.syncing
              : relative
                ? strings.widget.updatedAgo(relative)
                : strings.widget.neverSynced}
        </span>
        <span>{footerExtra ?? (readOnly ? strings.widget.readOnly : null)}</span>
      </footer>
    </section>
  );
}
