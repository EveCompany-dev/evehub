'use client';

import { useEffect, useState, type JSX } from 'react';
import { ConnectorsWorkspace } from './ConnectorsWorkspace';

/**
 * The team's own tools — Notion, Google Agenda, the Claude
 * assistant — on the Equipe page, folded like Cargos. The clients' social
 * media accounts are connected on each client's page instead. Admin-only,
 * like every credential.
 */
export function TeamConnectorsSection(): JSX.Element {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    // Back from "Conectar com Google" with a reason it didn't work (?googleAgenda=): show it open.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (new URLSearchParams(window.location.search).has('googleAgenda')) setOpen(true);
  }, []);

  return (
    <section className="eve-settings__section">
      <div className="eve-team__head">
        <h3 className="eve-card__title">Conectores</h3>
        <button type="button" className="eve-btn" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
          {open ? 'Fechar' : 'Gerenciar conectores'}
        </button>
      </div>
      {open && <ConnectorsWorkspace isOwner scope="team" />}
    </section>
  );
}
