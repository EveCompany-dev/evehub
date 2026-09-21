'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState, type JSX } from 'react';
import { pickProfile, PROFILE_FIELDS } from '../lib/client-profile-meta';
import { clientAccent, readableOn } from '../lib/table-tags';
import { ClientBrandEditor } from './ClientBrandEditor';
import { ClientSubTable } from './ClientSubTable';
import { LocalizedDateInput } from './LocalizedDateInput';
import type { ClientDetail, ClientUnassignedJob, ProjectWithJobCount } from './project-types';
import { ClientAvatar, TagPill } from './TagPill';

interface LinkedRowGroup {
  table: { id: string; name: string };
  count: number;
  rows: { id: string; title: string; tags: { name: string; color: string | null }[] }[];
}

export interface ClientDetailWorkspaceProps {
  clientId: string;
}

const IDEA_DEFAULTS = { status: 'Ideia' };

const MENU: [string, string][] = [
  ['informacoes', '🪪 Informações'],
  ['perfis', '🔗 Perfis sociais'],
  ['referencias', '🔎 Referências'],
  ['postagens', '📝 Postagens'],
  ['calendario', '📅 Calendário de Conteúdo'],
  ['projetos', '📁 Projetos e jobs'],
];

function jumpTo(id: string): void {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function formatDate(value: string | null): string | null {
  if (!value) return null;
  return new Date(value).toLocaleDateString('pt-BR');
}

/**
 * A client's "home page" — every project folder underneath it (see
 * ProjectDetailWorkspace for what a folder actually contains), plus any job
 * linked straight to the client but not yet filed into one. Client
 * identity (name, color, logo, emoji, notes) is edited here or from the Clientes
 * tab in Tabelas, through the same editor; table rows that point at this
 * client (the back-link of a relation column) are listed below it.
 */
export function ClientDetailWorkspace({ clientId }: ClientDetailWorkspaceProps): JSX.Element {
  const [client, setClient] = useState<ClientDetail | null>(null);
  const [unassignedJobs, setUnassignedJobs] = useState<ClientUnassignedJob[]>([]);
  const [projects, setProjects] = useState<ProjectWithJobCount[]>([]);
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

  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newDate, setNewDate] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [clientResponse, projectsResponse, linkedResponse] = await Promise.all([
        fetch(`/api/clients/${clientId}`, { cache: 'no-store' }),
        fetch(`/api/clients/${clientId}/projects`, { cache: 'no-store' }),
        fetch(`/api/clients/${clientId}/linked-rows`, { cache: 'no-store' }),
      ]);
      const clientBody = (await clientResponse.json().catch(() => ({}))) as {
        client?: ClientDetail;
        unassignedJobs?: ClientUnassignedJob[];
        error?: string;
      };
      const projectsBody = (await projectsResponse.json().catch(() => ({}))) as { projects?: ProjectWithJobCount[]; error?: string };

      if (!clientResponse.ok || !clientBody.client) {
        setError(clientBody.error ?? `HTTP ${clientResponse.status}`);
        return;
      }
      if (!projectsResponse.ok || !projectsBody.projects) {
        setError(projectsBody.error ?? `HTTP ${projectsResponse.status}`);
        return;
      }

      // Linked table rows are a nice-to-have on this page: a failure here must not hide the client.
      const linkedBody = (await linkedResponse.json().catch(() => ({}))) as { groups?: LinkedRowGroup[] };
      setLinkedRows(linkedResponse.ok ? (linkedBody.groups ?? []) : []);

      setClient(clientBody.client);
      setUnassignedJobs(clientBody.unassignedJobs ?? []);
      setProjects(projectsBody.projects);
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

  const createProject = async () => {
    if (!newTitle.trim()) return;
    setError(null);
    try {
      const response = await fetch(`/api/clients/${clientId}/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: newTitle.trim(),
          description: newDescription.trim() || undefined,
          date: newDate,
        }),
      });
      const body = (await response.json().catch(() => ({}))) as { project?: ProjectWithJobCount; error?: string };
      if (!response.ok || !body.project) {
        setError(body.error ?? `HTTP ${response.status}`);
        return;
      }
      setProjects((current) => [body.project!, ...current]);
      setNewTitle('');
      setNewDescription('');
      setNewDate(null);
      setCreating(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

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
            {client.projectCount} projeto(s) · {client.jobCount} job(s)
            {client.startDate && ` · cliente desde ${new Date(`${client.startDate}T00:00:00`).toLocaleDateString('pt-BR')}`}
          </p>
        </div>
        <button type="button" className="eve-btn" onClick={() => setEditingBrand(true)}>
          ✎ Editar identidade
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
              💡 Nova ideia de conteúdo
            </button>
            <button
              type="button"
              className="eve-shortcut"
              onClick={() => {
                setReferenceSignal((value) => value + 1);
                jumpTo('referencias');
              }}
            >
              🔎 Nova referência
            </button>
            <button
              type="button"
              className="eve-shortcut"
              onClick={() => {
                setProfileSignal((value) => value + 1);
                jumpTo('perfis');
              }}
            >
              🔗 Novo perfil social
            </button>
            <button
              type="button"
              className="eve-shortcut"
              onClick={() => {
                setCreating(true);
                jumpTo('projetos');
              }}
            >
              📁 Novo projeto
            </button>
          </div>
        </section>

        <nav className="eve-clientpage__panel" aria-label="Menu do cliente">
          <h3 className="eve-clientpage__panelhead">Menu</h3>
          <div className="eve-clientpage__menu">
            {MENU.map(([target, label]) => (
              <button key={target} type="button" className="eve-clientpage__menulink" onClick={() => jumpTo(target)}>
                {label}
              </button>
            ))}
          </div>
        </nav>
      </div>

      <section id="informacoes" className="eve-clientpage__section">
        <div className="eve-clientpage__section-head">
          <h3>Informações</h3>
          <button type="button" className="eve-btn" onClick={() => setEditingBrand(true)}>
            Editar
          </button>
        </div>
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
      </section>

      <ClientSubTable id="perfis" kind="profiles" title="Perfis sociais" clientId={clientId} modes={['table']} defaultMode="table" addSignal={profileSignal} />
      <ClientSubTable id="referencias" kind="references" title="Referências" clientId={clientId} modes={['table', 'gallery']} defaultMode="table" addSignal={referenceSignal} />
      <ClientSubTable
        key={`posts-${contentVersion.posts}`}
        id="postagens"
        kind="content"
        title="Postagens"
        hint="ideias e conteúdos deste cliente"
        clientId={clientId}
        modes={['table', 'gallery']}
        defaultMode="table"
        addSignal={contentSignal}
        addDefaults={IDEA_DEFAULTS}
        onRowsChange={onPostsChange}
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
      />

      {linkedRows.length > 0 && (
        <section className="eve-clientpage__section">
          <div className="eve-clientpage__section-head">
            <h3>Em outras tabelas</h3>
          </div>
          {linkedRows.map((group) => (
            <div key={group.table.id} className="eve-clientpage__linked">
              <div className="eve-clientpage__section-head">
                <h4>
                  {group.table.name} <span className="eve-dim">({group.count})</span>
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
        </section>
      )}

      <div id="projetos" className="eve-clientpage__section-head">
        <h3>Projetos</h3>
        {creating ? (
          <span className="eve-tables__new">
            <input
              className="eve-input"
              autoFocus
              placeholder="Título do projeto"
              value={newTitle}
              onChange={(event) => setNewTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') setCreating(false);
              }}
            />
            <input
              className="eve-input"
              placeholder="Descrição (opcional)"
              value={newDescription}
              onChange={(event) => setNewDescription(event.target.value)}
            />
            <LocalizedDateInput value={newDate} onChange={setNewDate} />
            <button type="button" className="eve-btn eve-btn--primary" onClick={() => void createProject()}>
              Criar
            </button>
            <button type="button" className="eve-btn" onClick={() => setCreating(false)}>
              Cancelar
            </button>
          </span>
        ) : (
          <button type="button" className="eve-btn eve-btn--primary" onClick={() => setCreating(true)}>
            + Novo projeto
          </button>
        )}
      </div>

      {projects.length === 0 ? (
        <div className="eve-empty">
          <p className="eve-dim">Nenhum projeto ainda. Crie o primeiro para agrupar os jobs deste cliente por período ou entrega.</p>
        </div>
      ) : (
        <div className="eve-projects-grid">
          {projects.map((project) => (
            <Link key={project.id} href={`/projects/${project.id}`} className="eve-projects-grid__card">
              <h4 className="eve-card__title">{project.title}</h4>
              {formatDate(project.date) && <p className="eve-dim">{formatDate(project.date)}</p>}
              {project.description && <p className="eve-projects-grid__desc">{project.description}</p>}
              <p className="eve-dim">{project._count.jobs} job(s)</p>
            </Link>
          ))}
        </div>
      )}

      {unassignedJobs.length > 0 && (
        <>
          <h3>Jobs sem projeto</h3>
          <ul className="eve-clientpage__joblist">
            {unassignedJobs.map((job) => (
              <li key={job.id}>
                <Link href={`/jobs?job=${job.id}`}>{job.title}</Link>
                <span className="eve-dim">{job.columnName}</span>
                {job.important && <span title="Importante">!</span>}
              </li>
            ))}
          </ul>
        </>
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
    </div>
  );
}
