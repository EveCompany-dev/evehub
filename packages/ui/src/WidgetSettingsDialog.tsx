'use client';

import {
  useEffect,
  useId,
  useRef,
  useState,
  type ComponentType,
  type JSX,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
  type SyntheticEvent,
} from 'react';
import { createPortal } from 'react-dom';
import type { LucideProps } from 'lucide-react';
import { Cable, Palette, RefreshCw, SlidersHorizontal, Trash2, Undo2, X } from './icons';
import { SettingsSection, SettingsToggle, Switch } from './settings-controls';
import { strings } from './strings';
import { visibleSettingsPages, type WidgetSettingsPageId, type WidgetSettingsPages } from './widget-settings-pages';
import type { WidgetAction } from './WidgetShell';

export interface WidgetSettingsDialogProps {
  open: boolean;
  title: string;
  icon?: ComponentType<LucideProps>;
  pages?: WidgetSettingsPages;
  /** The old ⋮ menu items of a widget not migrated yet; they render on the Geral page. */
  legacyActions?: WidgetAction[];
  locked?: boolean;
  onToggleLock?: () => void;
  onSyncNow?: () => void | Promise<void>;
  /** Present only while there is an edit to undo. */
  onUndoLast?: (() => void) | null;
  onRemove?: () => void;
  onClose: () => void;
  /** Gets focus back when the card closes — the ⋮ button that opened it. */
  returnFocusRef?: RefObject<HTMLElement | null>;
}

const PAGE_META: Record<WidgetSettingsPageId, { label: string; icon: ComponentType<LucideProps> }> = {
  geral: { label: strings.widgetSettings.pageGeneral, icon: SlidersHorizontal },
  estilo: { label: strings.widgetSettings.pageStyle, icon: Palette },
  conexao: { label: strings.widgetSettings.pageConnection, icon: Cable },
};

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * A widget's settings, as a floating card over the dashboard — what the ⋮ in
 * every widget header opens. Rendered in a portal on <body>: the grid
 * positions its tiles with CSS transforms, and a `position: fixed` element
 * inside a transformed ancestor would be placed relative to the tile instead
 * of the viewport.
 */
export function WidgetSettingsDialog(props: WidgetSettingsDialogProps): JSX.Element | null {
  if (!props.open || typeof document === 'undefined') return null;
  return createPortal(<DialogCard {...props} />, document.body);
}

/** Events from inside the portal still bubble through the React tree to the grid tile (drag, right-click menu, a widget's own key handling); none of them are meant for it. */
const stop = (event: SyntheticEvent) => event.stopPropagation();

function DialogCard({
  title,
  icon: Icon = SlidersHorizontal,
  pages,
  legacyActions = [],
  locked = false,
  onToggleLock,
  onSyncNow,
  onUndoLast,
  onRemove,
  onClose,
  returnFocusRef,
}: WidgetSettingsDialogProps): JSX.Element {
  const baseId = useId();
  const titleId = `${baseId}-title`;
  const lockId = `${baseId}-lock`;
  const pageIds = visibleSettingsPages(pages, legacyActions.length);
  const [chosen, setChosen] = useState<WidgetSettingsPageId | null>(pageIds[0] ?? null);
  const active = chosen && pageIds.includes(chosen) ? chosen : (pageIds[0] ?? null);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const removeRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const pressedOnBackdrop = useRef(false);
  const tabRefs = useRef(new Map<WidgetSettingsPageId, HTMLButtonElement>());

  // Focus moves into the card on open and back to the ⋮ button on close.
  useEffect(() => {
    const returnTo = returnFocusRef?.current ?? null;
    cardRef.current?.focus();
    return () => {
      if (returnTo?.isConnected) returnTo.focus();
    };
  }, [returnFocusRef]);

  // The confirmation takes focus; cancelling it hands focus back to the button that asked.
  const confirmedOnce = useRef(false);
  useEffect(() => {
    if (confirmingRemove) {
      confirmedOnce.current = true;
      confirmRef.current?.focus();
    } else if (confirmedOnce.current) {
      removeRef.current?.focus();
    }
  }, [confirmingRemove]);

  const trapFocus = (event: ReactKeyboardEvent) => {
    const card = cardRef.current;
    if (!card) return;
    const focusables = [...card.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
      (element) => element.offsetParent !== null || element === document.activeElement,
    );
    if (focusables.length === 0) {
      event.preventDefault();
      return;
    }
    const first = focusables[0]!;
    const last = focusables[focusables.length - 1]!;
    const current = document.activeElement;
    if (event.shiftKey && (current === first || current === card)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && current === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      if (confirmingRemove) setConfirmingRemove(false);
      else onClose();
      return;
    }
    if (event.key === 'Tab') trapFocus(event);
  };

  const onTabKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, id: WidgetSettingsPageId) => {
    const index = pageIds.indexOf(id);
    let next: WidgetSettingsPageId | undefined;
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') next = pageIds[(index + 1) % pageIds.length];
    else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') next = pageIds[(index - 1 + pageIds.length) % pageIds.length];
    else if (event.key === 'Home') next = pageIds[0];
    else if (event.key === 'End') next = pageIds[pageIds.length - 1];
    if (!next) return;
    event.preventDefault();
    setChosen(next);
    tabRefs.current.get(next)?.focus();
  };

  const runSync = async () => {
    if (!onSyncNow || syncing) return;
    setSyncing(true);
    try {
      await onSyncNow();
    } finally {
      setSyncing(false);
    }
  };

  const plainActions = legacyActions.filter((action) => action.checked === undefined);
  const toggleActions = legacyActions.filter((action) => action.checked !== undefined);

  const panel =
    active === null ? (
      <p className="eve-settings__empty">{strings.widgetSettings.nothingHere}</p>
    ) : (
      <>
        {pages?.[active]}
        {active === 'geral' && legacyActions.length > 0 && (
          <SettingsSection title={strings.widgetSettings.actionsSection}>
            {toggleActions.map((action) => (
              <SettingsToggle
                key={action.label}
                label={action.label}
                checked={Boolean(action.checked)}
                onChange={() => action.onSelect()}
              />
            ))}
            {plainActions.length > 0 && (
              <div className="eve-settings__buttons">
                {plainActions.map((action) => (
                  <button
                    key={action.label}
                    type="button"
                    className={action.danger ? 'eve-btn eve-btn--danger' : 'eve-btn'}
                    onClick={() => {
                      onClose();
                      action.onSelect();
                    }}
                  >
                    {action.label}
                  </button>
                ))}
              </div>
            )}
          </SettingsSection>
        )}
      </>
    );

  const hasFooter = Boolean(onToggleLock || onSyncNow || onUndoLast || onRemove);

  return (
    <div
      className="eve-backdrop eve-settings-backdrop eve-no-drag"
      role="presentation"
      onMouseDown={(event) => {
        stop(event);
        pressedOnBackdrop.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        stop(event);
        // Only a press that started AND ended on the backdrop closes — not a
        // text selection dragged out of an input and released outside.
        if (event.target === event.currentTarget && pressedOnBackdrop.current) onClose();
        pressedOnBackdrop.current = false;
      }}
      onPointerDown={stop}
      onTouchStart={stop}
      onContextMenu={stop}
      onDoubleClick={stop}
    >
      <div
        ref={cardRef}
        className={pageIds.length > 1 ? 'eve-settings has-nav' : 'eve-settings'}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <header className="eve-settings__head">
          <span className="eve-settings__icon" aria-hidden="true">
            <Icon size={18} />
          </span>
          <div className="eve-settings__heading">
            <h2 id={titleId} className="eve-settings__title">
              {title}
            </h2>
            <p className="eve-settings__subtitle">{strings.widgetSettings.subtitle}</p>
          </div>
          <button
            type="button"
            className="eve-btn eve-btn--icon"
            aria-label={strings.widgetSettings.close}
            title={strings.widgetSettings.close}
            onClick={onClose}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </header>

        <div className="eve-settings__main">
          {pageIds.length > 1 && (
            <nav className="eve-settings__nav" aria-label={strings.widgetSettings.pagesLabel}>
              <div role="tablist" aria-orientation="vertical" className="eve-settings__tabs">
                {pageIds.map((id) => {
                  const { label, icon: PageIcon } = PAGE_META[id];
                  const selected = id === active;
                  return (
                    <button
                      key={id}
                      ref={(node) => {
                        if (node) tabRefs.current.set(id, node);
                        else tabRefs.current.delete(id);
                      }}
                      type="button"
                      role="tab"
                      id={`${baseId}-tab-${id}`}
                      aria-selected={selected}
                      aria-controls={`${baseId}-panel`}
                      tabIndex={selected ? 0 : -1}
                      className={selected ? 'eve-settings__tab is-active' : 'eve-settings__tab'}
                      onClick={() => setChosen(id)}
                      onKeyDown={(event) => onTabKeyDown(event, id)}
                    >
                      <PageIcon size={15} aria-hidden="true" />
                      {label}
                    </button>
                  );
                })}
              </div>
            </nav>
          )}

          <div
            className="eve-settings__panel"
            id={`${baseId}-panel`}
            role={pageIds.length > 1 ? 'tabpanel' : undefined}
            aria-labelledby={pageIds.length > 1 && active ? `${baseId}-tab-${active}` : undefined}
          >
            {active && <h3 className="eve-settings__page-title">{PAGE_META[active].label}</h3>}
            {panel}
          </div>
        </div>

        {hasFooter && (
          <footer className="eve-settings__foot">
            {confirmingRemove ? (
              <div className="eve-settings__confirm" role="group" aria-label={strings.widgetSettings.remove}>
                <span className="eve-settings__confirm-text">{strings.widgetSettings.removeConfirm}</span>
                <span className="eve-settings__confirm-actions">
                  <button type="button" className="eve-btn" onClick={() => setConfirmingRemove(false)}>
                    {strings.widgetSettings.cancel}
                  </button>
                  <button
                    ref={confirmRef}
                    type="button"
                    className="eve-btn eve-btn--danger-solid"
                    onClick={() => {
                      onClose();
                      onRemove?.();
                    }}
                  >
                    {strings.widgetSettings.removeYes}
                  </button>
                </span>
              </div>
            ) : (
              <>
                {onToggleLock && (
                  <div className="eve-settings__lock">
                    <Switch id={lockId} checked={locked} onChange={() => onToggleLock()} />
                    <label htmlFor={lockId} title={strings.widgetSettings.lockHint}>
                      {strings.widgetSettings.lock}
                    </label>
                  </div>
                )}
                <div className="eve-settings__foot-actions">
                  {onUndoLast && (
                    <button type="button" className="eve-btn" onClick={() => onUndoLast()}>
                      <Undo2 size={14} aria-hidden="true" />
                      {strings.widgetSettings.undoLast}
                    </button>
                  )}
                  {onSyncNow && (
                    <button type="button" className="eve-btn" disabled={syncing} onClick={() => void runSync()}>
                      <RefreshCw size={14} aria-hidden="true" className={syncing ? 'eve-spin' : undefined} />
                      {syncing ? strings.widgetSettings.syncing : strings.widgetSettings.syncNow}
                    </button>
                  )}
                  {onRemove && (
                    <button
                      ref={removeRef}
                      type="button"
                      className="eve-btn eve-btn--danger"
                      onClick={() => setConfirmingRemove(true)}
                    >
                      <Trash2 size={14} aria-hidden="true" />
                      {strings.widgetSettings.remove}
                    </button>
                  )}
                </div>
              </>
            )}
          </footer>
        )}
      </div>
    </div>
  );
}
