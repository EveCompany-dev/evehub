'use client';

import Link from 'next/link';
import { AtSign, CalendarDays, FileText, Files, IdCard, Lightbulb, Link2, MessageSquareQuote, Pencil, Plug, Search, SquareKanban, X } from '@eve/ui';
import { useCallback, useEffect, useState, type JSX, type ReactNode } from 'react';
import { pickProfile, PROFILE_FIELDS } from '../lib/client-profile-meta';
import { clientAccent, readableOn } from '../lib/table-tags';
import { ClientActivity } from './ClientActivity';
import { ClientBrandEditor } from './ClientBrandEditor';
import { ClientConnectors } from './ClientConnectors';
import type { CalendarMenuTarget } from './CalendarView';
import { ClientSubTable } from './ClientSubTable';
import { CollapsibleSection, openSection } from './CollapsibleSection';
import type { ContextMenuItem } from './ContextMenu';
import type { DataTableRowValue } from './data-table-types';
import { PostComposer } from './PostComposer';
import type { ClientDetail } from './project-types';
import { ClientAvatar, TagPill } from './TagPill';

interface LinkedRowGroup {
  table: { id: string; name: string };
  count: number;
  rows: { id: string; title: string; tags: { name: string; color: string | null }[] }[];
}

export interface ClientDetailWorkspaceProps {
  clientId: string;
  /** Can open Agendar Post (the Agenda tab) — adds "Agendar post" to content rows and a right-click menu to the calendar. */
  canSchedule: boolean;
}

/** What the Agendar Post modal opens with: a content row to publish, or a day for a new post. */
type ComposerTarget = { rowId?: string; date?: Date };

const IDEA_DEFAULTS = { status: 'Ideia' };

const MENU: { target: string; label: string; icon: ReactNode }[] = [
  { target: 'informacoes', label: 'Informações', icon: <IdCard size={16} aria-hidden="true" /> },
  { target: 'perfis', label: 'Perfis sociais', icon: <AtSign size={16} aria-hidden="true" /> },
  { target: 'referencias', label: 'Referências', icon: <Search size={16} aria-hidden="true" /> },
  { target: 'postagens', label: 'Postagens', icon: <FileText size={16} aria-hidden="true" /> },
  { target: 'calendario', label: 'Calendário de Conteúdo', icon: <CalendarDays size={16} aria-hidden="true" /> },
  { target: 'jobs', label: 'Jobs', icon: <SquareKanban size={16} aria-hidden="true" /> },
  { target: 'arquivos', label: 'Arquivos', icon: <Files size={16} aria-hidden="true" /> },
  { target: 'mencoes', label: 'Menções', icon: <MessageSquareQuote size={16} aria-hidden="true" /> },
  { target: 'conectores', label: 'Conectores', icon: <Plug size={16} aria-hidden="true" /> },
];

function jumpTo(id: string): void {
  // A folded section has to open before there is anything to scroll to.
  openSection(id);
  window.setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
}

/**
 * A client's home page — everything the workspace knows about them in one place,
 * reached from its own Menu: identity and registration data, social profiles,
 * references, posts and the content calendar (sub-tables filtered by this
 * client), plus its jobs, files and mentions (see ClientActivity).
 */
export function ClientDetailWorkspace({ clientId, canSchedule }: ClientDetailWorkspaceProps): JSX.Element {
  // Agendar Post opens on top of this page — never another tab — from a row's page or a right-click on the calendar.
  const [composer, setComposer] = useState<ComposerTarget | null>(null);
  const rowAction = canSchedule
    ? (row: DataTableRowValue): ReactNode => (
        <button type="button" className="eve-btn eve-btn--primary" onClick={() => setComposer({ rowId: row.id })}>
          Agendar post
        </button>
      )
    : undefined;
  const calendarMenu = canSchedule
    ? ({ date }: CalendarMenuTarget): ContextMenuItem[] => [{ label: 'Agendar post neste dia', onSelect: () => setComposer({ date }) }]
    : undefined;
  const [client, setClient] = useState<ClientDetail | null>(null);
  const [linkedRows, setLinkedRows] = useState<LinkedRowGroup[]>([]);
  const [editingBrand, setEditingBrand] = useState(false);
  // Shortcut buttons bump these; the matching sub-table adds a row and opens it.
  const [contentSignal, setContentSignal] = useState(0);
  const [referenceSignal, setReferenceSignal] = useState(0);
  const [profileSignal, setProfileSignal] = useState(0);
  // Postagens and the calendar are two views of one table; a change in one refreshes the other.
  const [contentVersion, setContentVersion] = useState({ posts: 0, calendar: 0 });
  const onPostsChange = useCallback(() => setContentVersion((current) => ({ ...current, calendar: current.calendar + 1 })), []);
  const onCalendarChange = useCallback(() => setContentVersion((current) => ({ ...current, posts: current.posts + 1 })), []);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [clientResponse, linkedResponse] = await Promise.all([
        fetch(`/api/clients/${clientId}`, { cache: 'no-store' }),
        fetch(`/api/clients/${clientId}/linked-rows`, { cache: 'no-store' }),
      ]);
      const clientBody = (await clientResponse.json().catch(() => ({}))) as { client?: ClientDetail; error?: string };

      if (!clientResponse.ok || !clientBody.client) {
        setError(clientBody.error ?? `HTTP ${clientResponse.status}`);
        return;
      }

      // Linked table rows are a nice-to-have on this page: a failure here must not hide the client.
      const linkedBody = (await linkedResponse.json().catch(() => ({}))) as { groups?: LinkedRowGroup[] };
      setLinkedRows(linkedResponse.ok ? (linkedBody.groups ?? []) : []);

      setClient(clientBody.client);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => {
    // Mount fetch — setState happens after an await, same case as
    // useWidgetData.ts's initial fetch.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  if (loading) return <p className="eve-dim">carregando...</p>;
  if (!client) return <p className="eve-alert eve-alert--error">{error ?? 'Cliente não encontrado.'}</p>;

  const accent = clientAccent(client.name, client.color);

  return (
    <div className="eve-clientpage">
      {error && <p className="eve-alert eve-alert--error">{error}</p>}

      <div className="eve-clientbanner" style={{ background: accent, color: readableOn(accent) }}>
        {client.logoUrl ? (
          <ClientAvatar client={{ label: client.name, color: client.color, icon: client.icon, logoUrl: client.logoUrl }} size={96} bare />
        ) : (
          <span className="eve-clientbanner__initial">{client.icon || client.name.charAt(0).toUpperCase()}</span>
        )}
      </div>

      <header className="eve-clientpage__identity">
        <span className="eve-clientpage__badge">
          <ClientAvatar client={{ label: client.name, color: client.color, icon: client.icon, logoUrl: client.logoUrl }} size={64} />
        </span>
        <div className="eve-clientpage__heroinfo">
          <h2 className="eve-clientpage__name">{client.name}</h2>
          <p className="eve-clientpage__meta">
            {client.jobCount} job(s)
            {client.startDate && ` · cliente desde ${new Date(`${client.startDate}T00:00:00`).toLocaleDateString('pt-BR')}`}
          </p>
        </div>
        <button type="button" className="eve-btn" onClick={() => setEditingBrand(true)}>
          <Pencil size={14} aria-hidden="true" /> Editar identidade
        </button>
      </header>

      <div className="eve-clientpage__panels">
        <section className="eve-clientpage__panel">
          <h3 className="eve-clientpage__panelhead">Botões de atalho</h3>
          <div className="eve-clientpage__shortcuts">
            <button
              type="button"
              className="eve-shortcut"
              onClick={() => {
                setContentSignal((value) => value + 1);
                jumpTo('postagens');
              }}
            >
              <Lightbulb size={14} aria-hidden="true" /> Nova ideia de conteúdo
            </button>
            <button
              type="button"
              className="eve-shortcut"
              onClick={() => {
                setReferenceSignal((value) => value + 1);
                jumpTo('referencias');
              }}
            >
              <Search size={14} aria-hidden="true" /> Nova referência
            </button>
            <button
              type="button"
              className="eve-shortcut"
              onClick={() => {
                setProfileSignal((value) => value + 1);
                jumpTo('perfis');
              }}
            >
              <Link2 size={14} aria-hidden="true" /> Novo perfil social
            </button>
            <Link href={`/jobs?client=${clientId}`} className="eve-shortcut">
              <SquareKanban size={14} aria-hidden="true" /> Ver quadro de jobs
            </Link>
          </div>
        </section>

        <nav className="eve-clientpage__panel" aria-label="Menu do cliente">
          <h3 className="eve-clientpage__panelhead">Menu</h3>
          <div className="eve-clientpage__menu">
            {MENU.map(({ target, label, icon }) => (
              <button key={target} type="button" className="eve-clientpage__menulink" onClick={() => jumpTo(target)}>
                {icon}
                {label}
              </button>
            ))}
          </div>
        </nav>
      </div>

      <CollapsibleSection
        id="informacoes"
        title="Informações"
        actions={
          <button type="button" className="eve-btn" onClick={() => setEditingBrand(true)}>
            Editar
          </button>
        }
      >
        {client.notes && <p className="eve-dim eve-clientpage__notes">{client.notes}</p>}
        {PROFILE_FIELDS.some((field) => client[field.key]) ? (
          <dl className="eve-clientpage__facts">
            {PROFILE_FIELDS.filter((field) => client[field.key]).map((field) => (
              <div key={field.key}>
                <dt>{field.label}</dt>
                <dd>{field.input === 'date' ? new Date(`${client[field.key]}T00:00:00`).toLocaleDateString('pt-BR') : client[field.key]}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="eve-dim">Nenhum dado cadastral ainda (CNPJ, razão social, endereço…). Use “Editar” para preencher.</p>
        )}
      </CollapsibleSection>

      <ClientSubTable id="perfis" kind="profiles" title="Perfis sociais" clientId={clientId} modes={['table']} defaultMode="table" addSignal={profileSignal} />
      <ClientSubTable id="referencias" kind="references" title="Referências" clientId={clientId} modes={['table', 'gallery']} defaultMode="table" addSignal={referenceSignal} />
      <ClientSubTable
        key={`posts-${contentVersion.posts}`}
        id="postagens"
        kind="content"
        title="Postagens"
        clientId={clientId}
        modes={['table', 'gallery']}
        defaultMode="table"
        addSignal={contentSignal}
        addDefaults={IDEA_DEFAULTS}
        onRowsChange={onPostsChange}
        rowAction={rowAction}
      />
      <ClientSubTable
        key={`cal-${contentVersion.calendar}`}
        id="calendario"
        kind="content"
        title="Calendário de Conteúdo"
        clientId={clientId}
        modes={['calendar']}
        defaultMode="calendar"
        onRowsChange={onCalendarChange}
        rowAction={rowAction}
        calendarMenu={calendarMenu}
      />

      <ClientActivity clientId={clientId} />

      <CollapsibleSection
        id="conectores"
        title={
          <>
            <Plug size={16} aria-hidden="true" /> Conectores
          </>
        }
      >
        <ClientConnectors clientId={clientId} />
      </CollapsibleSection>

      {linkedRows.length > 0 && (
        <CollapsibleSection id="outras-tabelas" title="Em outras tabelas">
          {linkedRows.map((group) => (
            <div key={group.table.id} className="eve-clientpage__linked">
              <div className="eve-clientpage__section-head">
                <h4>
                  {group.table.name}
                </h4>
                <Link href={`/tables?table=${group.table.id}`} className="eve-btn">
                  Abrir tabela
                </Link>
              </div>
              <ul className="eve-clientpage__joblist">
                {group.rows.map((row) => (
                  <li key={row.id}>
                    <span>{row.title}</span>
                    {row.tags.map((tag) => (
                      <TagPill key={tag.name} name={tag.name} color={tag.color ?? undefined} />
                    ))}
                  </li>
                ))}
                {group.count > group.rows.length && <li className="eve-dim">…e mais {group.count - group.rows.length}</li>}
              </ul>
            </div>
          ))}
        </CollapsibleSection>
      )}

      {editingBrand && (
        <ClientBrandEditor
          client={{ id: client.id, name: client.name, notes: client.notes, color: client.color, icon: client.icon, logoUrl: client.logoUrl, ...pickProfile(client) }}
          onSaved={(saved) => {
            setClient((current) => (current ? { ...current, ...saved } : current));
            setEditingBrand(false);
          }}
          onClose={() => setEditingBrand(false)}
        />
      )}

      {composer && (
        // No close on backdrop click: a half-written post (or a batch) must not vanish on a stray click.
        <div className="eve-modal-backdrop">
          <div className="eve-modal eve-composer-modal" role="dialog" aria-label={`Agendar post · ${client.name}`}>
            <div className="eve-composer-modal__head">
              <h2 className="eve-card__title">Agendar post · {client.name}</h2>
              <button type="button" className="eve-btn eve-btn--icon" aria-label="Fechar" onClick={() => setComposer(null)}>
                <X size={16} aria-hidden="true" />
              </button>
            </div>
            <PostComposer
              rowId={composer.rowId}
              embedded={{
                clientId,
                ...(composer.date ? { date: composer.date } : {}),
                onDone: () => {
                  setComposer(null);
                  // The row's Status and date just changed: redraw both views of the content table.
                  setContentVersion((current) => ({ posts: current.posts + 1, calendar: current.calendar + 1 }));
                },
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
