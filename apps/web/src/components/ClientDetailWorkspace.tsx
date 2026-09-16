'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState, type JSX } from 'react';
import { LocalizedDateInput } from './LocalizedDateInput';
import type { ClientDetail, ClientUnassignedJob, ProjectWithJobCount } from './project-types';

export interface ClientDetailWorkspaceProps {
  clientId: string;
}

function formatDate(value: string | null): string | null {
  if (!value) return null;
  return new Date(value).toLocaleDateString('pt-BR');
}

/**
 * A client's "home page" — every project folder underneath it (see
 * ProjectDetailWorkspace for what a folder actually contains), plus any job
 * linked straight to the client but not yet filed into one. Client
 * name/notes stay editable only from Tabelas' ClientsPanel — this page reads
 * them but doesn't duplicate that CRUD.
 */
export function ClientDetailWorkspace({ clientId }: ClientDetailWorkspaceProps): JSX.Element {
  const [client, setClient] = useState<ClientDetail | null>(null);
  const [unassignedJobs, setUnassignedJobs] = useState<ClientUnassignedJob[]>([]);
  const [projects, setProjects] = useState<ProjectWithJobCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newDate, setNewDate] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [clientResponse, projectsResponse] = await Promise.all([
        fetch(`/api/clients/${clientId}`, { cache: 'no-store' }),
        fetch(`/api/clients/${clientId}/projects`, { cache: 'no-store' }),
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

  return (
    <div className="eve-clientpage">
      {error && <p className="eve-alert eve-alert--error">{error}</p>}

      <div className="eve-card">
        <h2 className="eve-card__title">{client.name}</h2>
        {client.notes && <p className="eve-dim">{client.notes}</p>}
        <p className="eve-dim">
          {client.projectCount} projeto(s) · {client.jobCount} job(s)
        </p>
      </div>

      <div className="eve-clientpage__section-head">
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
    </div>
  );
}
