'use client';

import { FileText, Files, MessageSquareQuote, Paperclip, SquareKanban } from '@eve/ui';
import Link from 'next/link';
import { useEffect, useState, type JSX } from 'react';
import { CollapsibleSection } from './CollapsibleSection';

interface ActivityJob {
  id: string;
  title: string;
  dueDate: string | null;
  important: boolean;
  columnName: string;
  projectTitle: string | null;
  tasksDone: number;
  tasksTotal: number;
}

interface ActivityFile {
  id: string;
  name: string;
  url: string;
  size: number | null;
  createdAt: string;
  origin: string;
  jobId: string | null;
}

interface ActivityMention {
  id: string;
  source: 'chat' | 'comment';
  where: string;
  href: string;
  author: string;
  body: string;
  createdAt: string;
}

interface Activity {
  jobs: ActivityJob[];
  files: ActivityFile[];
  mentions: ActivityMention[];
}

function formatSize(bytes: number | null): string {
  if (bytes === null) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDay(value: string | null): string | null {
  return value ? new Date(value).toLocaleDateString('pt-BR') : null;
}

/** A due date is a calendar day stored at UTC midnight — reading it in local time would show the day before in Brazil. */
function formatDueDay(value: string | null): string | null {
  return value ? new Date(value).toLocaleDateString('pt-BR', { timeZone: 'UTC' }) : null;
}

function excerpt(text: string, length = 160): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > length ? `${flat.slice(0, length)}…` : flat;
}

/**
 * Everything else the workspace holds about one client, so the client page is
 * the single place to look: its jobs (with the project they're filed under, if
 * any), its files, and where its name came up in chat and in other jobs.
 * Sections are anchors for the page's Menu.
 */
export function ClientActivity({ clientId }: { clientId: string }): JSX.Element {
  const [activity, setActivity] = useState<Activity | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(`/api/clients/${clientId}/activity`, { cache: 'no-store' });
        const body = (await response.json().catch(() => ({}))) as Partial<Activity> & { error?: string };
        if (cancelled) return;
        if (!response.ok || !body.jobs) setError(body.error ?? `HTTP ${response.status}`);
        else setActivity({ jobs: body.jobs, files: body.files ?? [], mentions: body.mentions ?? [] });
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  const loading = !activity && !error;

  return (
    <>
      <CollapsibleSection
        id="jobs"
        title={
          <>
            <SquareKanban size={16} aria-hidden="true" /> Jobs {activity && <span className="eve-dim">({activity.jobs.length})</span>}
          </>
        }
        actions={
          <Link href={`/jobs?client=${clientId}`} className="eve-btn">
            Abrir no quadro de jobs
          </Link>
        }
      >
        {error && <p className="eve-alert eve-alert--error">{error}</p>}
        {loading && <p className="eve-dim">carregando...</p>}
        {activity && activity.jobs.length === 0 && <p className="eve-dim">Nenhum job vinculado a este cliente ainda. Ao criar um job, escolha o cliente para ele aparecer aqui.</p>}
        {activity && activity.jobs.length > 0 && (
          <ul className="eve-clientpage__joblist">
            {activity.jobs.map((job) => (
              <li key={job.id}>
                <Link href={`/jobs?job=${job.id}`}>{job.title}</Link>
                <span className="eve-pill" data-color="gray">
                  <span className="eve-pill__text">{job.columnName}</span>
                </span>
                {job.projectTitle && <span className="eve-dim">{job.projectTitle}</span>}
                {job.tasksTotal > 0 && (
                  <span className="eve-dim">
                    {job.tasksDone}/{job.tasksTotal} tarefas
                  </span>
                )}
                {formatDueDay(job.dueDate) && <span className="eve-dim">até {formatDueDay(job.dueDate)}</span>}
                {job.important && <span title="Importante">!</span>}
              </li>
            ))}
          </ul>
        )}
      </CollapsibleSection>

      <CollapsibleSection
        id="arquivos"
        title={
          <>
            <Files size={16} aria-hidden="true" /> Arquivos {activity && <span className="eve-dim">({activity.files.length})</span>}
          </>
        }
        hint="anexos dos jobs e mídia dos posts agendados"
      >
        {activity && activity.files.length === 0 && <p className="eve-dim">Nenhum arquivo ainda.</p>}
        {activity && activity.files.length > 0 && (
          <ul className="eve-clientpage__joblist">
            {activity.files.map((file) => (
              <li key={file.id}>
                <Paperclip size={14} aria-hidden="true" />
                <a href={file.url} target="_blank" rel="noreferrer noopener">
                  {file.name}
                </a>
                <span className="eve-dim">{file.origin}</span>
                {formatSize(file.size) && <span className="eve-dim">{formatSize(file.size)}</span>}
                <span className="eve-dim">{formatDay(file.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </CollapsibleSection>

      <CollapsibleSection
        id="mencoes"
        title={
          <>
            <MessageSquareQuote size={16} aria-hidden="true" /> Menções {activity && <span className="eve-dim">({activity.mentions.length})</span>}
          </>
        }
        hint="onde o nome do cliente aparece no chat e em comentários de outros jobs"
      >
        {activity && activity.mentions.length === 0 && <p className="eve-dim">Nenhuma menção encontrada.</p>}
        {activity && activity.mentions.length > 0 && (
          <ul className="eve-clientpage__mentions">
            {activity.mentions.map((mention) => (
              <li key={mention.id}>
                <div className="eve-clientpage__mentionhead">
                  <FileText size={14} aria-hidden="true" />
                  <Link href={mention.href}>{mention.where}</Link>
                  <span className="eve-dim">
                    {mention.author} · {formatDay(mention.createdAt)}
                  </span>
                </div>
                <p>{excerpt(mention.body)}</p>
              </li>
            ))}
          </ul>
        )}
      </CollapsibleSection>
    </>
  );
}
