'use client';

import { ChevronDown, ChevronRight } from '@eve/ui';
import { useEffect, useState, type JSX, type ReactNode } from 'react';

const STORAGE_KEY = 'eve.clientpage.collapsed';
export const OPEN_SECTION_EVENT = 'eve:open-section';

function readCollapsed(): string[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '[]') as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function writeCollapsed(ids: string[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // Not remembered — the section still toggles.
  }
}

/** Asks the section with this id to expand (the page's Menu uses it before scrolling there). */
export function openSection(id: string): void {
  window.dispatchEvent(new CustomEvent(OPEN_SECTION_EVENT, { detail: id }));
}

export interface CollapsibleSectionProps {
  id: string;
  title: ReactNode;
  /** Small text next to the title (a count, a hint). */
  hint?: ReactNode;
  /** Buttons on the right of the header; they stay visible while the section is folded. */
  actions?: ReactNode;
  children: ReactNode;
}

/**
 * A section of the client page that folds away. What is folded is remembered
 * per browser (by section id), and the body stays mounted while hidden so a
 * half-edited cell or an open gallery keeps its state when you unfold it.
 */
export function CollapsibleSection({ id, title, hint, actions, children }: CollapsibleSectionProps): JSX.Element {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    // Mount-time read of an external system (localStorage), same case as SideRail.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCollapsed(readCollapsed().includes(id));
    const onOpen = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== id) return;
      setCollapsed(false);
      writeCollapsed(readCollapsed().filter((item) => item !== id));
    };
    window.addEventListener(OPEN_SECTION_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_SECTION_EVENT, onOpen);
  }, [id]);

  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    const others = readCollapsed().filter((item) => item !== id);
    writeCollapsed(next ? [...others, id] : others);
  };

  return (
    <section id={id} className="eve-clientpage__section">
      <div className="eve-clientpage__section-head">
        <button type="button" className="eve-clientpage__toggle" aria-expanded={!collapsed} aria-controls={`${id}-body`} onClick={toggle}>
          {collapsed ? <ChevronRight size={16} aria-hidden="true" /> : <ChevronDown size={16} aria-hidden="true" />}
          <h3>{title}</h3>
          {hint && <span className="eve-dim eve-clientpage__hint">{hint}</span>}
        </button>
        {actions && <div className="eve-clientpage__actions">{actions}</div>}
      </div>
      <div id={`${id}-body`} className="eve-clientpage__body" hidden={collapsed}>
        {children}
      </div>
    </section>
  );
}
