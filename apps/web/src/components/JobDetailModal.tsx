'use client';

import { strings } from '@eve/ui';
import Link from 'next/link';
import { cloneElement, isValidElement, useEffect, useRef, useState, type JSX, type ReactNode } from 'react';
import { JobCommentsTab } from './JobCommentsTab';
import { linkify } from './Linkify';
import { renderRichText } from './RichText';
import { useFormattingToolbar } from './useFormattingToolbar';
import {
  memberInitials,
  memberLabel,
  type AttachmentSummary,
  type JobMember,
  type JobSummary,
  type JobTaskSummary,
  type TimeEntrySummary,
} from './job-types';
import { JobTimesheetTab } from './JobTimesheetTab';
import { LocalizedDateInput } from './LocalizedDateInput';
import { MemberSelect } from './MemberSelect';
import { PauseIcon, PlayIcon } from './TimerIcons';
import { useEscapeToClose } from './useEscapeToClose';

export interface JobDetailModalProps {
  job: JobSummary;
  members: JobMember[];
  currentUserId: string;
  runningEntry: TimeEntrySummary | null;
  onStartTimer: (taskId: string | null) => void;
  onStopTimer: () => void;
  onClose: () => void;
  onJobChange: (job: JobSummary) => void;
  onJobDeleted: (jobId: string) => void;
}

type Tab = 'details' | 'timesheet';

function DocIcon(): JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6 3.5h9l4 4V20a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1Z" stroke="currentColor" strokeWidth="1.8" />
      <path d="M9 12h7M9 16h7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function FolderIcon(): JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M3.5 6.5a1 1 0 0 1 1-1H10l2 2.2h7.5a1 1 0 0 1 1 1V18a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1V6.5Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CalendarIcon(): JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3.5" y="5" width="17" height="15" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M3.5 9.5h17M8 3v4M16 3v4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function PeopleIcon(): JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="9" cy="8" r="3" stroke="currentColor" strokeWidth="1.8" />
      <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="17" cy="7" r="2.2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M15.5 13c2.6.4 4.5 2.6 4.5 5.3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function ChecklistIcon(): JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3.5" y="4.5" width="6" height="6" rx="1.2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M5 7.5l1.2 1.2L8.5 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M13 6.5h7.5M3.5 15.5h6M13 15.5h7.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <rect x="3.5" y="13.5" width="6" height="6" rx="1.2" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

function ChatIcon(): JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 5.5h16a1 1 0 0 1 1 1V15a1 1 0 0 1-1 1H9l-4.2 3.5A.6.6 0 0 1 4 19.05V16H4a1 1 0 0 1-1-1V6.5a1 1 0 0 1 1-1Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PaperclipIcon(): JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M8 12.5 15 5.5a3 3 0 0 1 4.2 4.2l-8.5 8.5a5 5 0 1 1-7-7l7.5-7.5"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ClockIcon(): JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 7.5V12l3 2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * Leaf-level highlighter passed into renderRichText() as `extra`: any
 * substring matching a known local client's name (longest name wins on
 * overlap) gets a hover tooltip offering to link the job to that client on
 * click; everything else still goes through linkify(). Full "@ mention
 * search" is deliberately out of scope for this pass — see the project's
 * task notes.
 */
function highlightClientNames(text: string, clients: { id: string; name: string }[], onLinkClient: (clientId: string) => void): ReactNode[] {
  if (!clients.length) return linkify(text);

  const pattern = new RegExp(
    `(${[...clients]
      .sort((a, b) => b.name.length - a.name.length)
      .map((client) => client.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('|')})`,
    'gi',
  );
  const segments = text.split(pattern);
  const nodes: ReactNode[] = [];

  segments.forEach((segment, index) => {
    if (!segment) return;
    const match = clients.find((client) => client.name.toLowerCase() === segment.toLowerCase());
    if (match) {
      nodes.push(
        <span
          key={`client-${index}`}
          className="eve-client-match"
          data-tooltip={`Vincular ao cliente ${match.name}`}
          onClick={(event) => {
            event.stopPropagation();
            onLinkClient(match.id);
          }}
        >
          {segment}
        </span>,
      );
      return;
    }
    linkify(segment).forEach((node, subIndex) => {
      nodes.push(isValidElement(node) ? cloneElement(node, { key: `text-${index}-${subIndex}` }) : node);
    });
  });

  return nodes;
}

export function JobDetailModal({
  job,
  members,
  currentUserId,
  runningEntry,
  onStartTimer,
  onStopTimer,
  onClose,
  onJobChange,
  onJobDeleted,
}: JobDetailModalProps): JSX.Element {
  useEscapeToClose(onClose);
  const [tab, setTab] = useState<Tab>('details');
  const [title, setTitle] = useState(job.title);
  const [description, setDescription] = useState(job.description ?? '');
  const [error, setError] = useState<string | null>(null);
  const [addingTask, setAddingTask] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [dragOverTaskId, setDragOverTaskId] = useState<string | null>(null);
  const [uploadingTaskId, setUploadingTaskId] = useState<string | null>(null);
  const [pendingAttachTaskId, setPendingAttachTaskId] = useState<string | null>(null);
  const [editingDescription, setEditingDescription] = useState(false);
  const [clients, setClients] = useState<{ id: string; name: string }[]>([]);
  const [clientProjects, setClientProjects] = useState<{ id: string; title: string }[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { textareaRef: descriptionRef, toolbar: descriptionToolbar } = useFormattingToolbar(description, setDescription);

  useEffect(() => {
    // Mount fetch — same legitimate case as useWidgetData.ts's initial fetch.
    void (async () => {
      try {
        const response = await fetch('/api/scheduling/clients', { cache: 'no-store' });
        const body = (await response.json().catch(() => ({}))) as { clients?: { source: string; id: string; label: string }[] };
        if (response.ok && body.clients) {
          setClients(body.clients.filter((client) => client.source === 'local').map((client) => ({ id: client.id, name: client.label })));
        }
      } catch {
        // Non-critical: the description just won't highlight client-name matches.
      }
    })();
  }, []);

  // Reloads whenever the linked client changes — a job's project can only be
  // one of that client's own folders.
  useEffect(() => {
    void (async () => {
      if (!job.clientId) {
        setClientProjects([]);
        return;
      }
      try {
        const response = await fetch(`/api/clients/${job.clientId}/projects`, { cache: 'no-store' });
        const body = (await response.json().catch(() => ({}))) as { projects?: { id: string; title: string }[] };
        if (response.ok && body.projects) setClientProjects(body.projects);
      } catch {
        // Non-critical: the project picker just won't populate.
      }
    })();
  }, [job.clientId]);

  const patchJob = async (patch: Record<string, unknown>) => {
    setError(null);
    try {
      const response = await fetch(`/api/jobs/${job.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const body = (await response.json().catch(() => ({}))) as { job?: JobSummary; error?: string };
      if (!response.ok || !body.job) {
        setError(body.error ?? `HTTP ${response.status}`);
        return;
      }
      onJobChange(body.job);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const linkClient = (clientId: string) => void patchJob({ clientId });
  const unlinkClient = () => void patchJob({ clientId: null });

  const addCollaborator = async (userId: string) => {
    setError(null);
    try {
      const response = await fetch(`/api/jobs/${job.id}/collaborators`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      });
      const body = (await response.json().catch(() => ({}))) as { job?: JobSummary; error?: string };
      if (!response.ok || !body.job) {
        setError(body.error ?? `HTTP ${response.status}`);
        return;
      }
      onJobChange(body.job);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const removeCollaborator = async (userId: string) => {
    setError(null);
    try {
      const response = await fetch(`/api/jobs/${job.id}/collaborators`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      });
      const body = (await response.json().catch(() => ({}))) as { job?: JobSummary; error?: string };
      if (!response.ok || !body.job) {
        setError(body.error ?? `HTTP ${response.status}`);
        return;
      }
      onJobChange(body.job);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const addTask = async () => {
    if (!newTaskTitle.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/jobs/${job.id}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: newTaskTitle.trim() }),
      });
      const body = (await response.json().catch(() => ({}))) as { task?: JobTaskSummary; error?: string };
      if (!response.ok || !body.task) {
        setError(body.error ?? `HTTP ${response.status}`);
        return;
      }
      onJobChange({ ...job, tasks: [...job.tasks, body.task] });
      setNewTaskTitle('');
      setAddingTask(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const patchTask = async (taskId: string, patch: Record<string, unknown>) => {
    setError(null);
    try {
      const response = await fetch(`/api/jobs/${job.id}/tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const body = (await response.json().catch(() => ({}))) as { task?: JobTaskSummary; error?: string };
      if (!response.ok || !body.task) {
        setError(body.error ?? `HTTP ${response.status}`);
        return;
      }
      onJobChange({ ...job, tasks: job.tasks.map((task) => (task.id === taskId ? body.task! : task)) });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const deleteTask = async (taskId: string) => {
    setError(null);
    try {
      const response = await fetch(`/api/jobs/${job.id}/tasks/${taskId}`, { method: 'DELETE' });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? `HTTP ${response.status}`);
        return;
      }
      onJobChange({ ...job, tasks: job.tasks.filter((task) => task.id !== taskId) });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const uploadAttachment = async (taskId: string, file: File) => {
    setUploadingTaskId(taskId);
    setError(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const response = await fetch(`/api/jobs/${job.id}/tasks/${taskId}/attachments`, { method: 'POST', body: form });
      const body = (await response.json().catch(() => ({}))) as { attachment?: AttachmentSummary; error?: string };
      if (!response.ok || !body.attachment) {
        setError(body.error ?? `HTTP ${response.status}`);
        return;
      }
      onJobChange({
        ...job,
        tasks: job.tasks.map((task) =>
          task.id === taskId ? { ...task, attachments: [...task.attachments, body.attachment!] } : task,
        ),
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setUploadingTaskId(null);
    }
  };

  const deleteAttachment = async (taskId: string, attachmentId: string) => {
    setError(null);
    try {
      const response = await fetch(`/api/jobs/${job.id}/tasks/${taskId}/attachments/${attachmentId}`, { method: 'DELETE' });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? `HTTP ${response.status}`);
        return;
      }
      onJobChange({
        ...job,
        tasks: job.tasks.map((task) =>
          task.id === taskId ? { ...task, attachments: task.attachments.filter((item) => item.id !== attachmentId) } : task,
        ),
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const deleteJob = async () => {
    setError(null);
    try {
      const response = await fetch(`/api/jobs/${job.id}`, { method: 'DELETE' });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? `HTTP ${response.status}`);
        return;
      }
      onJobDeleted(job.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const collaboratorIds = new Set(job.collaborators.map((collaborator) => collaborator.userId));
  const availableMembers = members.filter((member) => !collaboratorIds.has(member.id) && member.id);
  const collaboratorUsers = job.collaborators.map((collaborator) => collaborator.user);
  const creator = members.find((member) => member.id === job.createdBy);
  const creatorLabel = creator
    ? job.createdBy === currentUserId
      ? strings.team.you
      : memberLabel(creator)
    : null;

  const isGeneralRunning = runningEntry?.jobId === job.id && runningEntry?.taskId === null;
  const isTaskRunning = (taskId: string) => runningEntry?.jobId === job.id && runningEntry?.taskId === taskId;
  const toggleGeneralTimer = () => (isGeneralRunning ? onStopTimer() : onStartTimer(null));
  const toggleTaskTimer = (taskId: string) => (isTaskRunning(taskId) ? onStopTimer() : onStartTimer(taskId));

  return (
    <div className="eve-modal-backdrop" onClick={onClose}>
      <div className="eve-modal eve-modal--wide" onClick={(event) => event.stopPropagation()}>
        {error && <p className="eve-alert eve-alert--error">{error}</p>}

        <div className="eve-jobs__header-row">
          <button
            type="button"
            className={isGeneralRunning ? 'eve-btn eve-btn--icon eve-jobs__timer-toggle is-active' : 'eve-btn eve-btn--icon eve-jobs__timer-toggle'}
            title={isGeneralRunning ? strings.jobs.timerGeneralStop : strings.jobs.timerGeneralStart}
            aria-label={isGeneralRunning ? strings.jobs.timerGeneralStop : strings.jobs.timerGeneralStart}
            onClick={toggleGeneralTimer}
          >
            {isGeneralRunning ? <PauseIcon /> : <PlayIcon />}
          </button>
          <button
            type="button"
            className={job.important ? 'eve-btn eve-btn--icon eve-jobs__important-toggle is-active' : 'eve-btn eve-btn--icon eve-jobs__important-toggle'}
            title={job.important ? 'Remover marcação de importante' : 'Marcar como importante'}
            aria-label={job.important ? 'Remover marcação de importante' : 'Marcar como importante'}
            onClick={() => void patchJob({ important: !job.important })}
          >
            !
          </button>
          {creatorLabel && <span className="eve-jobs__subtitle">{strings.jobs.createdBy(creatorLabel)}</span>}
          {job.client && (
            <span className="eve-jobs__client-badge">
              <Link href={`/clients/${job.client.id}`} onClick={(event) => event.stopPropagation()}>
                {job.client.name}
              </Link>
              <button type="button" className="eve-jobs__client-unlink" aria-label="Desvincular cliente" onClick={unlinkClient}>
                &times;
              </button>
            </span>
          )}
        </div>

        <input
          className="eve-input eve-jobs__title-input"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onBlur={() => {
            if (title.trim() && title.trim() !== job.title) void patchJob({ title: title.trim() });
            else setTitle(job.title);
          }}
        />

        <div className="eve-jobs__tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'details'}
            className={tab === 'details' ? 'eve-jobs__tab is-active' : 'eve-jobs__tab'}
            onClick={() => setTab('details')}
          >
            <ChecklistIcon /> {strings.jobs.tabDetails}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'timesheet'}
            className={tab === 'timesheet' ? 'eve-jobs__tab is-active' : 'eve-jobs__tab'}
            onClick={() => setTab('timesheet')}
          >
            <ClockIcon /> {strings.jobs.tabTimesheet}
          </button>
        </div>

        {tab === 'details' && (
          <div className="eve-jobs__tabpanel eve-jobs__tabpanel--split">
            <div className="eve-jobs__tabpanel-main">
            <label className="eve-field">
              <span className="eve-field__label eve-field__label--icon">
                <DocIcon /> {strings.jobs.description}
              </span>
              {editingDescription ? (
                <>
                  <textarea
                    ref={descriptionRef}
                    className="eve-input"
                    rows={3}
                    autoFocus
                    placeholder={strings.jobs.descriptionPlaceholder}
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    onBlur={() => {
                      if (description !== (job.description ?? '')) void patchJob({ description: description || null });
                      setEditingDescription(false);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Escape') {
                        setDescription(job.description ?? '');
                        setEditingDescription(false);
                      }
                    }}
                  />
                  {descriptionToolbar}
                </>
              ) : (
                <div className="eve-jobs__description-view" onClick={() => setEditingDescription(true)}>
                  {description ? (
                    renderRichText(description, (segment) => highlightClientNames(segment, clients, linkClient))
                  ) : (
                    <span className="eve-dim">{strings.jobs.descriptionPlaceholder}</span>
                  )}
                </div>
              )}
            </label>

            <label className="eve-field">
              <span className="eve-field__label eve-field__label--icon">
                <CalendarIcon /> {strings.jobs.dueDate}
              </span>
              <LocalizedDateInput value={job.dueDate} onChange={(iso) => void patchJob({ dueDate: iso })} />
            </label>

            {job.clientId && (
              <label className="eve-field">
                <span className="eve-field__label eve-field__label--icon">
                  <FolderIcon /> Projeto
                </span>
                <select
                  className="eve-input"
                  value={job.projectId ?? ''}
                  onChange={(event) => void patchJob({ projectId: event.target.value || null })}
                >
                  <option value="">Sem projeto</option>
                  {clientProjects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.title}
                    </option>
                  ))}
                </select>
                {job.project && (
                  <Link href={`/projects/${job.project.id}`} className="eve-dim">
                    Abrir pasta do projeto →
                  </Link>
                )}
              </label>
            )}

            <div className="eve-field">
              <span className="eve-field__label eve-field__label--icon">
                <PeopleIcon /> {strings.jobs.collaborators}
              </span>
              {job.collaborators.length === 0 && <p className="eve-dim">{strings.jobs.noCollaborators}</p>}
              <ul className="eve-jobs__collaborator-list">
                {job.collaborators.map((collaborator) => (
                  <li key={collaborator.id} className="eve-jobs__collaborator">
                    <span className="eve-avatar eve-avatar--fallback" style={{ width: 24, height: 24, fontSize: 10 }}>
                      {memberInitials(collaborator.user)}
                    </span>
                    <span>{memberLabel(collaborator.user)}</span>
                    <button
                      type="button"
                      className="eve-btn eve-btn--icon"
                      title={strings.jobs.removeCollaborator}
                      onClick={() => void removeCollaborator(collaborator.userId)}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
              {availableMembers.length > 0 && (
                <MemberSelect
                  members={availableMembers}
                  value={null}
                  placeholder={strings.jobs.pickMember}
                  onChange={(userId) => userId && void addCollaborator(userId)}
                />
              )}
            </div>

            <div className="eve-field">
              <span className="eve-field__label eve-field__label--icon">
                <ChecklistIcon /> {strings.jobs.tasks}
              </span>
              {job.tasks.length === 0 && <p className="eve-dim">{strings.jobs.noTasks}</p>}
              <ul className="eve-jobs__task-list">
                {job.tasks.map((task) => (
                  <li
                    key={task.id}
                    className={[
                      'eve-jobs__task',
                      task.done ? 'is-done' : '',
                      dragOverTaskId === task.id ? 'is-drag-over' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    onDragOver={(event) => {
                      event.preventDefault();
                      setDragOverTaskId(task.id);
                    }}
                    onDragLeave={() => setDragOverTaskId((current) => (current === task.id ? null : current))}
                    onDrop={(event) => {
                      event.preventDefault();
                      setDragOverTaskId(null);
                      const file = event.dataTransfer.files[0];
                      if (file) void uploadAttachment(task.id, file);
                    }}
                  >
                    <div className="eve-jobs__task-row">
                      <input
                        type="checkbox"
                        checked={task.done}
                        onChange={(event) => void patchTask(task.id, { done: event.target.checked })}
                      />
                      <button
                        type="button"
                        className={
                          isTaskRunning(task.id)
                            ? 'eve-btn eve-btn--icon eve-jobs__timer-toggle is-active'
                            : 'eve-btn eve-btn--icon eve-jobs__timer-toggle'
                        }
                        title={isTaskRunning(task.id) ? strings.jobs.timerTaskStop : strings.jobs.timerTaskStart}
                        aria-label={isTaskRunning(task.id) ? strings.jobs.timerTaskStop : strings.jobs.timerTaskStart}
                        onClick={() => toggleTaskTimer(task.id)}
                      >
                        {isTaskRunning(task.id) ? <PauseIcon /> : <PlayIcon />}
                      </button>
                      <span className="eve-jobs__task-title">{task.title}</span>
                      <MemberSelect
                        members={collaboratorUsers}
                        value={task.assignee?.id ?? null}
                        placeholder={strings.jobs.unassigned}
                        noneLabel={strings.jobs.unassigned}
                        onChange={(userId) => void patchTask(task.id, { assigneeId: userId })}
                      />
                      <button
                        type="button"
                        className={
                          task.important
                            ? 'eve-btn eve-btn--icon eve-jobs__important-toggle is-active'
                            : 'eve-btn eve-btn--icon eve-jobs__important-toggle'
                        }
                        title={task.important ? 'Remover marcação de importante' : 'Marcar como importante'}
                        aria-label={task.important ? 'Remover marcação de importante' : 'Marcar como importante'}
                        onClick={() => void patchTask(task.id, { important: !task.important })}
                      >
                        !
                      </button>
                      <button
                        type="button"
                        className="eve-btn eve-btn--icon"
                        title={strings.jobs.attachFile}
                        onClick={() => {
                          setPendingAttachTaskId(task.id);
                          fileInputRef.current?.click();
                        }}
                      >
                        <PaperclipIcon />
                      </button>
                      <button
                        type="button"
                        className="eve-btn eve-btn--icon"
                        title={strings.jobs.deleteTask}
                        onClick={() => void deleteTask(task.id)}
                      >
                        ×
                      </button>
                    </div>

                    {uploadingTaskId === task.id && <p className="eve-dim eve-jobs__task-uploading">{strings.jobs.uploadingFile}</p>}

                    {task.attachments.length > 0 && (
                      <ul className="eve-jobs__attachments">
                        {task.attachments.map((attachment) => (
                          <li key={attachment.id} className="eve-jobs__attachment">
                            <PaperclipIcon />
                            <a href={attachment.url} target="_blank" rel="noreferrer" className="eve-jobs__attachment-name">
                              {attachment.filename}
                            </a>
                            <button
                              type="button"
                              className="eve-btn eve-btn--icon"
                              title={strings.jobs.removeAttachment}
                              onClick={() => void deleteAttachment(task.id, attachment.id)}
                            >
                              ×
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>

              <input
                ref={fileInputRef}
                type="file"
                hidden
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file && pendingAttachTaskId) void uploadAttachment(pendingAttachTaskId, file);
                  event.target.value = '';
                  setPendingAttachTaskId(null);
                }}
              />

              {addingTask ? (
                <div className="eve-jobs__add-form">
                  <input
                    className="eve-input"
                    autoFocus
                    placeholder={strings.jobs.taskTitlePlaceholder}
                    value={newTaskTitle}
                    onChange={(event) => setNewTaskTitle(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') void addTask();
                      if (event.key === 'Escape') setAddingTask(false);
                    }}
                  />
                  <div className="eve-jobs__add-form-actions">
                    <button type="button" className="eve-btn eve-btn--primary" disabled={busy} onClick={() => void addTask()}>
                      {strings.jobs.newTask}
                    </button>
                    <button type="button" className="eve-btn" onClick={() => setAddingTask(false)}>
                      {strings.edit.cancel}
                    </button>
                  </div>
                </div>
              ) : (
                <button type="button" className="eve-btn" onClick={() => setAddingTask(true)}>
                  + {strings.jobs.newTask}
                </button>
              )}
            </div>
            </div>

            <div className="eve-jobs__tabpanel-side">
              <span className="eve-field__label eve-field__label--icon">
                <ChatIcon /> {strings.jobs.tabComments}
              </span>
              <JobCommentsTab jobId={job.id} currentUserId={currentUserId} />
            </div>
          </div>
        )}

        {tab === 'timesheet' && (
          <div className="eve-jobs__tabpanel">
            <JobTimesheetTab jobId={job.id} />
          </div>
        )}

        <div className="eve-profile__actions">
          <button type="button" className="eve-btn eve-btn--danger" onClick={() => void deleteJob()}>
            {strings.jobs.deleteJob}
          </button>
          <button type="button" className="eve-btn" onClick={onClose}>
            {strings.jobs.close}
          </button>
        </div>
      </div>
    </div>
  );
}
