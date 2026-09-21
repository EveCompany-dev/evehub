'use client';

import { strings, Trash2, X } from '@eve/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState, type JSX } from 'react';
import { LocalizedDateInput } from './LocalizedDateInput';
import { formatDateTimePtBr, memberInitials, memberLabel, type JobSummary } from './job-types';
import type { ProjectDetail, ProjectJobSummary } from './project-types';
import { renderRichText } from './RichText';
import { useFormattingToolbar } from './useFormattingToolbar';

export interface ProjectDetailWorkspaceProps {
  projectId: string;
}

type Tab = 'jobs' | 'tasks' | 'chats' | 'files';

function formatDate(value: string | null): string | null {
  if (!value) return null;
  return new Date(value).toLocaleDateString('pt-BR');
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * A project "folder": everything attached to a client for one period or
 * delivery, seen in one place — the jobs filed into it, and (flattened
 * across those jobs) their tasks, comments ("chats"), and attachments
 * ("files"). Individual jobs are still edited from the Jobs board itself
 * (via the `?job=` deep link JobsBoard already supports) — this page is the
 * aggregate view, not a duplicate editor.
 */
export function ProjectDetailWorkspace({ projectId }: ProjectDetailWorkspaceProps): JSX.Element {
  const router = useRouter();
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [jobs, setJobs] = useState<ProjectJobSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('jobs');

  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [editingDescription, setEditingDescription] = useState(false);
  const [descriptionDraft, setDescriptionDraft] = useState('');
  const { textareaRef: descriptionRef, toolbar: descriptionToolbar } = useFormattingToolbar(descriptionDraft, setDescriptionDraft);

  const [attachOpen, setAttachOpen] = useState(false);
  const [attachableJobs, setAttachableJobs] = useState<JobSummary[] | null>(null);
  const [attachError, setAttachError] = useState<string | null>(null);

  const [commentJobId, setCommentJobId] = useState('');
  const [commentDraft, setCommentDraft] = useState('');
  const [sendingComment, setSendingComment] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/projects/${projectId}`, { cache: 'no-store' });
      const body = (await response.json().catch(() => ({}))) as {
        project?: ProjectDetail;
        jobs?: ProjectJobSummary[];
        error?: string;
      };
      if (!response.ok || !body.project) {
        setError(body.error ?? `HTTP ${response.status}`);
        return;
      }
      setProject(body.project);
      setJobs(body.jobs ?? []);
      setTitleDraft(body.project.title);
      setDescriptionDraft(body.project.description ?? '');
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    // Mount fetch — setState happens after an await, same case as
    // useWidgetData.ts's initial fetch.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const patchProject = async (data: Record<string, unknown>) => {
    setError(null);
    try {
      const response = await fetch(`/api/projects/${projectId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      const body = (await response.json().catch(() => ({}))) as { project?: ProjectDetail; error?: string };
      if (!response.ok || !body.project) {
        setError(body.error ?? `HTTP ${response.status}`);
        return;
      }
      setProject((current) => (current ? { ...current, ...body.project } : current));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const deleteProject = async () => {
    if (!project) return;
    if (!window.confirm('Apagar este projeto? Os jobs continuam existindo, só deixam de estar organizados nele.')) return;
    try {
      const response = await fetch(`/api/projects/${projectId}`, { method: 'DELETE' });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? `HTTP ${response.status}`);
        return;
      }
      router.push(`/clients/${project.clientId}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const openAttach = async () => {
    setAttachOpen(true);
    if (attachableJobs) return;
    setAttachError(null);
    try {
      const response = await fetch('/api/jobs', { cache: 'no-store' });
      const body = (await response.json().catch(() => ({}))) as { jobs?: JobSummary[]; error?: string };
      if (!response.ok || !body.jobs) {
        setAttachError(body.error ?? `HTTP ${response.status}`);
        return;
      }
      setAttachableJobs(body.jobs);
    } catch (cause) {
      setAttachError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const attachJob = async (jobId: string) => {
    setAttachError(null);
    try {
      const response = await fetch(`/api/jobs/${jobId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        setAttachError(body.error ?? `HTTP ${response.status}`);
        return;
      }
      setAttachOpen(false);
      setAttachableJobs(null);
      void load();
    } catch (cause) {
      setAttachError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const unlinkJob = async (jobId: string) => {
    setError(null);
    try {
      const response = await fetch(`/api/jobs/${jobId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: null }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? `HTTP ${response.status}`);
        return;
      }
      setJobs((current) => current.filter((job) => job.id !== jobId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const toggleTaskDone = async (jobId: string, taskId: string, done: boolean) => {
    setError(null);
    try {
      const response = await fetch(`/api/jobs/${jobId}/tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ done }),
      });
      const body = (await response.json().catch(() => ({}))) as { task?: ProjectJobSummary['tasks'][number]; error?: string };
      if (!response.ok || !body.task) {
        setError(body.error ?? `HTTP ${response.status}`);
        return;
      }
      setJobs((current) =>
        current.map((job) =>
          job.id === jobId ? { ...job, tasks: job.tasks.map((task) => (task.id === taskId ? body.task! : task)) } : job,
        ),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const sendComment = async () => {
    if (!commentJobId || !commentDraft.trim()) return;
    setSendingComment(true);
    setError(null);
    try {
      const response = await fetch(`/api/jobs/${commentJobId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: commentDraft.trim() }),
      });
      const body = (await response.json().catch(() => ({}))) as { comment?: ProjectJobSummary['comments'][number]; error?: string };
      if (!response.ok || !body.comment) {
        setError(body.error ?? `HTTP ${response.status}`);
        return;
      }
      setJobs((current) =>
        current.map((job) => (job.id === commentJobId ? { ...job, comments: [...job.comments, body.comment!] } : job)),
      );
      setCommentDraft('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSendingComment(false);
    }
  };

  const allTasks = useMemo(
    () => jobs.flatMap((job) => job.tasks.map((task) => ({ task, job }))),
    [jobs],
  );
  const allComments = useMemo(
    () =>
      jobs
        .flatMap((job) => job.comments.map((comment) => ({ comment, job })))
        .sort((a, b) => a.comment.createdAt.localeCompare(b.comment.createdAt)),
    [jobs],
  );
  const allFiles = useMemo(
    () =>
      jobs.flatMap((job) =>
        job.tasks.flatMap((task) => task.attachments.map((attachment) => ({ attachment, task, job }))),
      ),
    [jobs],
  );

  if (loading) return <p className="eve-dim">carregando...</p>;
  if (!project) return <p className="eve-alert eve-alert--error">{error ?? 'Projeto não encontrado.'}</p>;

  return (
    <div className="eve-projectpage">
      {error && <p className="eve-alert eve-alert--error">{error}</p>}

      <div className="eve-projectpage__head">
        {project.client && (
          <Link href={`/clients/${project.client.id}`} className="eve-jobs__client-badge">
            {project.client.name}
          </Link>
        )}
        <button type="button" className="eve-btn eve-btn--icon" title="Apagar projeto" aria-label="Apagar projeto" onClick={() => void deleteProject()}>
          <Trash2 size={14} aria-hidden="true" />
        </button>
      </div>

      {editingTitle ? (
        <input
          className="eve-input eve-projectpage__title-input"
          autoFocus
          value={titleDraft}
          onChange={(event) => setTitleDraft(event.target.value)}
          onBlur={() => {
            setEditingTitle(false);
            if (titleDraft.trim() && titleDraft.trim() !== project.title) void patchProject({ title: titleDraft.trim() });
            else setTitleDraft(project.title);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              setTitleDraft(project.title);
              setEditingTitle(false);
            }
            if (event.key === 'Enter') event.currentTarget.blur();
          }}
        />
      ) : (
        <h1 className="eve-projectpage__title" onClick={() => setEditingTitle(true)}>
          {project.title}
        </h1>
      )}

      <label className="eve-field">
        <span className="eve-field__label">Data de referência</span>
        <LocalizedDateInput value={project.date} onChange={(iso) => void patchProject({ date: iso })} />
      </label>

      <label className="eve-field">
        <span className="eve-field__label">Descrição</span>
        {editingDescription ? (
          <>
            <textarea
              ref={descriptionRef}
              className="eve-input"
              rows={3}
              autoFocus
              value={descriptionDraft}
              onChange={(event) => setDescriptionDraft(event.target.value)}
              onBlur={() => {
                setEditingDescription(false);
                if (descriptionDraft !== (project.description ?? '')) void patchProject({ description: descriptionDraft || null });
              }}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  setDescriptionDraft(project.description ?? '');
                  setEditingDescription(false);
                }
              }}
            />
            {descriptionToolbar}
          </>
        ) : (
          <div className="eve-jobs__description-view" onClick={() => setEditingDescription(true)}>
            {project.description ? renderRichText(project.description) : <span className="eve-dim">Descrição...</span>}
          </div>
        )}
      </label>

      <div className="eve-jobs__tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'jobs'} className={tab === 'jobs' ? 'eve-jobs__tab is-active' : 'eve-jobs__tab'} onClick={() => setTab('jobs')}>
          Jobs ({jobs.length})
        </button>
        <button type="button" role="tab" aria-selected={tab === 'tasks'} className={tab === 'tasks' ? 'eve-jobs__tab is-active' : 'eve-jobs__tab'} onClick={() => setTab('tasks')}>
          Tarefas ({allTasks.length})
        </button>
        <button type="button" role="tab" aria-selected={tab === 'chats'} className={tab === 'chats' ? 'eve-jobs__tab is-active' : 'eve-jobs__tab'} onClick={() => setTab('chats')}>
          Comentários ({allComments.length})
        </button>
        <button type="button" role="tab" aria-selected={tab === 'files'} className={tab === 'files' ? 'eve-jobs__tab is-active' : 'eve-jobs__tab'} onClick={() => setTab('files')}>
          Arquivos ({allFiles.length})
        </button>
      </div>

      {tab === 'jobs' && (
        <div className="eve-projectpage__panel">
          {attachOpen ? (
            <div className="eve-tables__new">
              {attachError && <p className="eve-alert eve-alert--error">{attachError}</p>}
              {attachableJobs === null ? (
                <p className="eve-dim">carregando...</p>
              ) : (
                <select
                  className="eve-input"
                  defaultValue=""
                  onChange={(event) => event.target.value && void attachJob(event.target.value)}
                >
                  <option value="" disabled>
                    Escolher job existente...
                  </option>
                  {attachableJobs
                    .filter((job) => job.projectId !== projectId)
                    .map((job) => (
                      <option key={job.id} value={job.id}>
                        {job.title}
                        {job.client ? ` (${job.client.name})` : ''}
                      </option>
                    ))}
                </select>
              )}
              <button type="button" className="eve-btn" onClick={() => setAttachOpen(false)}>
                Cancelar
              </button>
            </div>
          ) : (
            <button type="button" className="eve-btn eve-btn--primary" onClick={() => void openAttach()}>
              + Adicionar job existente
            </button>
          )}

          {jobs.length === 0 ? (
            <div className="eve-empty">
              <p className="eve-dim">Nenhum job neste projeto ainda.</p>
            </div>
          ) : (
            <ul className="eve-projectpage__joblist">
              {jobs.map((job) => (
                <li key={job.id}>
                  <Link href={`/jobs?job=${job.id}`}>{job.title}</Link>
                  <span className="eve-dim">{job.column.name}</span>
                  {formatDate(job.dueDate) && <span className="eve-dim">{formatDate(job.dueDate)}</span>}
                  {job.important && <span title="Importante">!</span>}
                  <button type="button" className="eve-btn eve-btn--icon" title="Remover do projeto" onClick={() => void unlinkJob(job.id)}>
                    <X size={14} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {tab === 'tasks' && (
        <div className="eve-projectpage__panel">
          {allTasks.length === 0 ? (
            <div className="eve-empty">
              <p className="eve-dim">{strings.jobs.noTasks}</p>
            </div>
          ) : (
            <ul className="eve-jobs__task-list">
              {allTasks.map(({ task, job }) => (
                <li key={task.id} className={task.done ? 'eve-jobs__task is-done' : 'eve-jobs__task'}>
                  <div className="eve-jobs__task-row">
                    <input type="checkbox" checked={task.done} onChange={(event) => void toggleTaskDone(job.id, task.id, event.target.checked)} />
                    <span className="eve-jobs__task-title">{task.title}</span>
                    <Link href={`/jobs?job=${job.id}`} className="eve-dim">
                      {job.title}
                    </Link>
                    {task.assignee && <span className="eve-dim">{memberLabel(task.assignee)}</span>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {tab === 'chats' && (
        <div className="eve-projectpage__panel">
          <div className="eve-tables__new">
            <select className="eve-input" value={commentJobId} onChange={(event) => setCommentJobId(event.target.value)}>
              <option value="" disabled>
                Comentar em...
              </option>
              {jobs.map((job) => (
                <option key={job.id} value={job.id}>
                  {job.title}
                </option>
              ))}
            </select>
            <input
              className="eve-input"
              placeholder={strings.jobs.commentPlaceholder}
              value={commentDraft}
              onChange={(event) => setCommentDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void sendComment();
              }}
            />
            <button type="button" className="eve-btn eve-btn--primary" disabled={sendingComment || !commentJobId} onClick={() => void sendComment()}>
              {strings.jobs.commentSend}
            </button>
          </div>

          {allComments.length === 0 ? (
            <div className="eve-empty">
              <p className="eve-dim">{strings.jobs.commentsEmpty}</p>
            </div>
          ) : (
            <ul className="eve-projectpage__commentlist">
              {allComments.map(({ comment, job }) => (
                <li key={comment.id}>
                  <span className="eve-avatar eve-avatar--fallback" style={{ width: 24, height: 24, fontSize: 10 }}>
                    {memberInitials(comment.author)}
                  </span>
                  <div>
                    <p className="eve-dim">
                      {memberLabel(comment.author)} · {job.title} · {formatDateTimePtBr(comment.createdAt)}
                    </p>
                    <div>{renderRichText(comment.body)}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {tab === 'files' && (
        <div className="eve-projectpage__panel">
          {allFiles.length === 0 ? (
            <div className="eve-empty">
              <p className="eve-dim">Nenhum arquivo ainda.</p>
            </div>
          ) : (
            <ul className="eve-projectpage__filelist">
              {allFiles.map(({ attachment, task, job }) => (
                <li key={attachment.id}>
                  <a href={attachment.url} target="_blank" rel="noopener noreferrer">
                    {attachment.filename}
                  </a>
                  <span className="eve-dim">{formatSize(attachment.size)}</span>
                  <span className="eve-dim">
                    {job.title} / {task.title}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
