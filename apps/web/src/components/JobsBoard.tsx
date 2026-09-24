'use client';

import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  pointerWithin,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type Modifier,
  type Over,
} from '@dnd-kit/core';
import {
  arrayMove,
  horizontalListSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Plus, strings } from '@eve/ui';
import { useSearchParams } from 'next/navigation';
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type JSX,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { ConfirmButton } from './ConfirmButton';
import { useContextMenu } from './ContextMenu';
import { JobCreateModal } from './JobCreateModal';
import { JobDetailModal } from './JobDetailModal';
import { hexToRgba, memberInitials, memberLabel, type JobColumnSummary, type JobMember, type JobSummary, type JobsView } from './job-types';
import { useTimer } from './TimerProvider';

export interface JobsBoardProps {
  currentUserId: string;
  /** Admins see the Concluídos and Apagados lists and can delete, reopen and restore. */
  isAdmin: boolean;
}

interface ColumnsResponse {
  columns?: JobColumnSummary[];
  error?: string;
}

interface JobsResponse {
  jobs?: JobSummary[];
  error?: string;
}

interface MembersResponse {
  members?: JobMember[];
  error?: string;
}

function formatDueDate(value: string | null): string | null {
  if (!value) return null;
  try {
    return new Date(value).toLocaleDateString('pt-BR');
  } catch {
    return null;
  }
}

interface JobDropTarget {
  columnId: string;
  index: number;
}

/**
 * `pointerWithin` resolves to whichever droppable the pointer is literally
 * inside of (falling back to `closestCenter` for keyboard dragging, or the
 * rare frame where the pointer isn't over anything) — unlike `closestCorners`,
 * it doesn't get confused by a large ambient rect (the column) competing with
 * the small rects nested inside it (each job card), which used to mean you
 * had to land dead-center on a card for it to register.
 */
const collisionDetectionStrategy: CollisionDetection = (args) => {
  const pointerCollisions = pointerWithin(args);
  return pointerCollisions.length > 0 ? pointerCollisions : closestCenter(args);
};

/**
 * Where a dragged job would land — the destination column and its slot
 * within it, excluding the dragged job itself. Shared by the live drag-over
 * preview and the actual drop handler so they never disagree. Only 'job' and
 * 'column-cards' droppables count as a job target; the column's own (much
 * larger) droppable — active only in manage mode, for column reordering — is
 * ignored outright rather than relying on collision detection to never pick
 * it over a nested one.
 */
function computeJobDropTarget(activeJobId: string, over: Over | null, jobs: JobSummary[]): JobDropTarget | null {
  if (!over) return null;
  const overType = over.data.current?.type as string | undefined;
  if (overType !== 'job' && overType !== 'column-cards') return null;
  const destColumnId = over.data.current?.columnId as string | undefined;
  if (!destColumnId) return null;

  const destJobIds = jobs
    .filter((job) => job.columnId === destColumnId && job.id !== activeJobId)
    .sort((a, b) => a.position - b.position)
    .map((job) => job.id);

  let index = destJobIds.length;
  if (overType === 'job') {
    const overIndex = destJobIds.indexOf(over.id as string);
    if (overIndex !== -1) index = overIndex;
  }
  return { columnId: destColumnId, index };
}

/**
 * The Interface settings' uiScale applies via `document.documentElement.style.zoom`
 * (see SettingsSections.tsx's InterfaceSection), not a CSS transform. dnd-kit's pointer
 * math is computed in unzoomed CSS pixels but the translate3d it emits gets re-scaled by
 * that ancestor zoom when painted, so the dragged card/overlay drifts from the cursor by
 * a factor proportional to the zoom level. Dividing the delta by the current zoom here
 * cancels that out.
 */
const zoomAwareModifier: Modifier = ({ transform }) => {
  const zoom = typeof document !== 'undefined' ? Number(document.documentElement.style.zoom) || 1 : 1;
  if (zoom === 1) return transform;
  return { ...transform, x: transform.x / zoom, y: transform.y / zoom };
};

function DropPlaceholder(): JSX.Element {
  return <div className="eve-job-card eve-job-card--placeholder" aria-hidden="true" />;
}

/** Pure visual content, shared by the real (sortable) card and the DragOverlay's static preview. */
function JobCardBody({ job }: { job: JobSummary }): JSX.Element {
  const dueDate = formatDueDate(job.dueDate);
  const doneCount = job.tasks.filter((task) => task.done).length;

  return (
    <>
      <p className="eve-job-card__title">
        {job.important && (
          <span className="eve-job-card__important" title="Importante">
            !
          </span>
        )}
        {job.title}
      </p>
      <div className="eve-job-card__meta">
        {job.client && <span className="eve-job-card__client">{job.client.name}</span>}
        {dueDate && <span className="eve-job-card__due">{dueDate}</span>}
        {job.tasks.length > 0 && (
          <span className="eve-job-card__tasks">
            {doneCount}/{job.tasks.length}
          </span>
        )}
      </div>
      {(job.responsible || job.collaborators.length > 0) && (
        <div className="eve-job-card__avatars">
          {job.responsible && (
            <span
              className="eve-avatar eve-avatar--fallback eve-job-card__responsible"
              style={{ width: 22, height: 22, fontSize: 10 }}
              title={`${strings.jobs.responsible}: ${memberLabel(job.responsible)}`}
            >
              {memberInitials(job.responsible)}
            </span>
          )}
          {job.collaborators.map((collaborator) => (
            <span
              key={collaborator.id}
              className="eve-avatar eve-avatar--fallback"
              style={{ width: 22, height: 22, fontSize: 10 }}
              title={memberLabel(collaborator.user)}
            >
              {memberInitials(collaborator.user)}
            </span>
          ))}
        </div>
      )}
    </>
  );
}

/** The floating copy that follows the cursor in DragOverlay — deliberately NOT sortable: registering useSortable a second time under the same id as the real card would fight it for dnd-kit's id registry. */
function JobCardOverlay({ job }: { job: JobSummary }): JSX.Element {
  return (
    <div className="eve-job-card eve-job-card--overlay">
      <JobCardBody job={job} />
    </div>
  );
}

interface JobCardProps {
  job: JobSummary;
  onOpen: (jobId: string) => void;
}

function JobCard({ job, onOpen }: JobCardProps): JSX.Element {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: job.id,
    data: { type: 'job', columnId: job.columnId },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    // dnd-kit keeps pointer capture on this element (not the DragOverlay clone) for the
    // whole drag, so the OS cursor tracks this element's `cursor`, not `.eve-job-card--overlay`'s.
    cursor: isDragging ? 'grabbing' : 'grab',
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className="eve-job-card"
      role="button"
      tabIndex={0}
      onClick={() => onOpen(job.id)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') onOpen(job.id);
      }}
    >
      <JobCardBody job={job} />
    </div>
  );
}

function formatDay(value: string | null | undefined): string {
  if (!value) return '';
  try {
    return new Date(value).toLocaleDateString('pt-BR');
  } catch {
    return '';
  }
}

interface JobsListViewProps {
  view: Exclude<JobsView, 'active'>;
  jobs: JobSummary[];
  loading: boolean;
  onOpen: (jobId: string) => void;
  onReopen: (jobId: string) => void;
  onRestore: (jobId: string) => void;
  onPurge: (jobId: string) => void;
}

/** Concluídos and Apagados (admin-only): a plain list, newest first, with the one action each needs. */
function JobsListView({ view, jobs, loading, onOpen, onReopen, onRestore, onPurge }: JobsListViewProps): JSX.Element {
  if (loading) return <p className="eve-dim">Carregando...</p>;
  if (jobs.length === 0) {
    return <p className="eve-dim">{view === 'trash' ? strings.jobs.listEmptyTrash : strings.jobs.listEmptyConcluded}</p>;
  }
  return (
    <ul className="eve-jobs__list">
      {jobs.map((job) => (
        <li key={job.id} className="eve-jobs__list-item">
          <button type="button" className="eve-jobs__list-title" disabled={view === 'trash'} onClick={() => onOpen(job.id)}>
            {job.title}
          </button>
          {job.client && <span className="eve-dim">{job.client.name}</span>}
          {job.responsible && <span className="eve-dim">{memberLabel(job.responsible)}</span>}
          <span className="eve-dim">
            {view === 'trash' ? strings.jobs.trashExpires(formatDay(job.trashExpiresAt)) : strings.jobs.concludedOn(formatDay(job.concludedAt))}
          </span>
          <span className="eve-jobs__list-actions">
            {view === 'concluded' ? (
              <button type="button" className="eve-btn" onClick={() => onReopen(job.id)}>
                {strings.jobs.reopen}
              </button>
            ) : (
              <>
                <button type="button" className="eve-btn" onClick={() => onRestore(job.id)}>
                  {strings.jobs.restore}
                </button>
                <ConfirmButton confirmLabel={strings.jobs.purgeConfirm} question={strings.jobs.purgeQuestion} onConfirm={() => onPurge(job.id)}>
                  {strings.jobs.purge}
                </ConfirmButton>
              </>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

interface BoardColumnProps {
  column: JobColumnSummary;
  jobs: JobSummary[];
  manageMode: boolean;
  placeholderIndex: number | null;
  onOpenJob: (jobId: string) => void;
  onAddJob: (columnId: string, title: string) => void;
  onContextMenu: (event: ReactMouseEvent, column: JobColumnSummary) => void;
}

function BoardColumn({
  column,
  jobs,
  manageMode,
  placeholderIndex,
  onOpenJob,
  onAddJob,
  onContextMenu,
}: BoardColumnProps): JSX.Element {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: column.id,
    data: { type: 'column' },
    // Outside manage mode the column itself isn't a drag/drop target at all —
    // only the dedicated cards-area droppable below handles job drops, so the
    // column's own (much larger) rect never competes with a card's for
    // pointerWithin/closestCenter.
    disabled: { draggable: !manageMode, droppable: !manageMode },
  });
  const { setNodeRef: setCardsRef, isOver: isCardsOver } = useDroppable({
    id: `column-drop-${column.id}`,
    data: { type: 'column-cards', columnId: column.id },
  });
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    ...(column.color
      ? {
          backgroundColor: hexToRgba(column.color, column.colorOpacity ?? 1),
          borderColor: column.borderColor ?? column.color,
        }
      : undefined),
  };

  const submit = () => {
    if (!title.trim()) return;
    onAddJob(column.id, title.trim());
    setTitle('');
    setAdding(false);
  };

  return (
    <div ref={setNodeRef} style={style} className="eve-jobs__column">
      <div
        className={manageMode ? 'eve-jobs__column-head is-draggable' : 'eve-jobs__column-head'}
        style={manageMode ? { cursor: isDragging ? 'grabbing' : 'grab' } : undefined}
        {...(manageMode ? attributes : {})}
        {...(manageMode ? listeners : {})}
        onContextMenu={(event) => onContextMenu(event, column)}
      >
        <span className="eve-jobs__column-title">{column.name}</span>
        <button
          type="button"
          className="eve-btn eve-btn--icon"
          title={strings.jobs.newJob}
          aria-label={strings.jobs.newJob}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            setAdding(true);
          }}
        >
          +
        </button>
      </div>

      {/*
        Fica logo abaixo do cabecalho, e nao no pe da coluna: numa coluna
        cheia o pe esta fora da tela, entao o campo abria longe do "+" que
        acabou de ser clicado e parecia que nada tinha acontecido.
      */}
      {adding && (
        <div className="eve-jobs__add-form">
          <input
            className="eve-input"
            autoFocus
            placeholder={strings.jobs.jobTitlePlaceholder}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') submit();
              if (event.key === 'Escape') setAdding(false);
            }}
          />
          <div className="eve-jobs__add-form-actions">
            <button type="button" className="eve-btn eve-btn--primary" onClick={submit}>
              {strings.jobs.newJob}
            </button>
            <button type="button" className="eve-btn" onClick={() => setAdding(false)}>
              {strings.edit.cancel}
            </button>
          </div>
        </div>
      )}

      <SortableContext items={jobs.map((job) => job.id)} strategy={verticalListSortingStrategy}>
        <div
          ref={setCardsRef}
          className={isCardsOver ? 'eve-jobs__cards is-drop-target' : 'eve-jobs__cards'}
          data-column-id={column.id}
        >
          {jobs.length === 0 && placeholderIndex === null ? (
            <p className="eve-dim eve-jobs__empty-column">{strings.jobs.noJobs}</p>
          ) : (
            jobs.flatMap((job, index) => {
              const card = <JobCard key={job.id} job={job} onOpen={onOpenJob} />;
              return placeholderIndex === index ? [<DropPlaceholder key="__placeholder" />, card] : [card];
            })
          )}
          {placeholderIndex !== null && placeholderIndex >= jobs.length && <DropPlaceholder />}
        </div>
      </SortableContext>
    </div>
  );
}

export function JobsBoard({ currentUserId, isAdmin }: JobsBoardProps): JSX.Element {
  const [columns, setColumns] = useState<JobColumnSummary[]>([]);
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [members, setMembers] = useState<JobMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<JobDropTarget | null>(null);
  const [openJobId, setOpenJobId] = useState<string | null>(null);
  const [newColumnName, setNewColumnName] = useState('');
  const [addingColumn, setAddingColumn] = useState(false);
  const [manageMode, setManageMode] = useState(false);
  const [view, setView] = useState<JobsView>('active');
  const [listJobs, setListJobs] = useState<JobSummary[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [creating, setCreating] = useState<{ columnId?: string; title?: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const { runningEntry, startTimer, stopTimer } = useTimer();

  const menu = useContextMenu();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [columnsRes, jobsRes, membersRes] = await Promise.all([
        fetch('/api/jobs/columns', { cache: 'no-store' }),
        fetch('/api/jobs', { cache: 'no-store' }),
        fetch('/api/workspace/members', { cache: 'no-store' }),
      ]);
      const columnsBody = (await columnsRes.json().catch(() => ({}))) as ColumnsResponse;
      const jobsBody = (await jobsRes.json().catch(() => ({}))) as JobsResponse;
      const membersBody = (await membersRes.json().catch(() => ({}))) as MembersResponse;

      if (!columnsRes.ok || !columnsBody.columns) {
        setError(columnsBody.error ?? `HTTP ${columnsRes.status}`);
        return;
      }
      if (!jobsRes.ok || !jobsBody.jobs) {
        setError(jobsBody.error ?? `HTTP ${jobsRes.status}`);
        return;
      }

      setColumns(columnsBody.columns);
      setJobs(jobsBody.jobs);
      setMembers(membersRes.ok && membersBody.members ? membersBody.members : []);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Mount fetch — every setState below happens after an await, same
    // legitimate case documented in useWidgetData.ts's initial fetch.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const loadList = useCallback(async (which: Exclude<JobsView, 'active'>) => {
    setListLoading(true);
    try {
      const response = await fetch(`/api/jobs?view=${which}`, { cache: 'no-store' });
      const body = (await response.json().catch(() => ({}))) as JobsResponse;
      if (!response.ok || !body.jobs) {
        setError(body.error ?? `HTTP ${response.status}`);
        setListJobs([]);
        return;
      }
      setListJobs(body.jobs);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setListLoading(false);
    }
  }, []);

  const changeView = (next: JobsView) => {
    setView(next);
    setOpenJobId(null);
    if (next !== 'active') void loadList(next);
  };

  // Deep-link from a notification ("...?job=<id>"): open it once the board
  // has loaded, but only the first time it appears — closing the modal
  // afterward shouldn't keep reopening it while the query param is still in
  // the URL. Adjusting state during render (per
  // https://react.dev/learn/you-might-not-need-an-effect) rather than an
  // effect, since it's derived purely from data already available here.
  const searchParams = useSearchParams();
  const deepLinkJobId = searchParams.get('job');
  // '' = every client, '__none__' = jobs without one, otherwise a client id.
  const [clientFilter, setClientFilter] = useState<string>(() => searchParams.get('client') ?? '');
  // '' = everyone, '__none__' = no responsável, otherwise a member id.
  const [responsibleFilter, setResponsibleFilter] = useState<string>('');
  // '' = everyone, otherwise a member who is among the envolvidos.
  const [involvedFilter, setInvolvedFilter] = useState<string>('');
  const [deepLinkApplied, setDeepLinkApplied] = useState(false);
  if (deepLinkJobId && !deepLinkApplied && jobs.some((job) => job.id === deepLinkJobId)) {
    setOpenJobId(deepLinkJobId);
    setDeepLinkApplied(true);
  }

  const shownJobs = view === 'active' ? jobs : listJobs;

  const clientOptions = useMemo(() => {
    const byId = new Map<string, string>();
    for (const job of shownJobs) if (job.client) byId.set(job.client.id, job.client.name);
    // Keep the filtered-to client selectable even when it currently has no job (a stale link).
    if (clientFilter && clientFilter !== '__none__' && !byId.has(clientFilter)) byId.set(clientFilter, 'Cliente');
    return [...byId.entries()].sort((a, b) => a[1].localeCompare(b[1], 'pt-BR'));
  }, [shownJobs, clientFilter]);

  const filterJobs = useCallback(
    (list: JobSummary[]) =>
      list.filter((job) => {
        if (clientFilter && (clientFilter === '__none__' ? job.clientId : job.clientId !== clientFilter)) return false;
        if (responsibleFilter && (responsibleFilter === '__none__' ? job.responsibleId : job.responsibleId !== responsibleFilter)) return false;
        if (involvedFilter && !job.collaborators.some((collaborator) => collaborator.userId === involvedFilter)) return false;
        return true;
      }),
    [clientFilter, responsibleFilter, involvedFilter],
  );

  const visibleJobs = useMemo(() => filterJobs(jobs), [filterJobs, jobs]);
  const visibleListJobs = useMemo(() => filterJobs(listJobs), [filterJobs, listJobs]);
  const hasFilter = Boolean(clientFilter || responsibleFilter || involvedFilter);

  const jobsByColumn = useMemo(() => {
    const map = new Map<string, JobSummary[]>();
    for (const column of columns) map.set(column.id, []);
    for (const job of [...visibleJobs].sort((a, b) => a.position - b.position)) {
      const list = map.get(job.columnId);
      if (list) list.push(job);
    }
    return map;
  }, [columns, visibleJobs]);

  /** Column management used to live behind a cog in the toolbar; now it is a right-click away. */
  const boardMenuItems = () => [
    { label: '', separator: true },
    {
      label: strings.jobs.newColumn,
      onSelect: () => {
        setManageMode(true);
        setAddingColumn(true);
      },
    },
    { label: manageMode ? 'Concluir reordenação' : 'Reordenar colunas', onSelect: () => setManageMode((value) => !value) },
  ];

  const activeJob = activeId ? jobs.find((job) => job.id === activeId) ?? null : null;
  const activeColumn = activeId ? columns.find((column) => column.id === activeId) ?? null : null;
  const openJob = openJobId ? shownJobs.find((job) => job.id === openJobId) ?? null : null;

  const lifecycle = async (jobId: string, request: { url: string; method: string; body?: unknown }): Promise<boolean> => {
    setError(null);
    try {
      const response = await fetch(request.url, {
        method: request.method,
        ...(request.body !== undefined ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request.body) } : {}),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? `HTTP ${response.status}`);
        return false;
      }
      setListJobs((current) => current.filter((job) => job.id !== jobId));
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      return false;
    }
  };

  const reopenJob = async (jobId: string) => {
    if (await lifecycle(jobId, { url: `/api/jobs/${jobId}`, method: 'PATCH', body: { concluded: false } })) void load();
  };
  const restoreJob = async (jobId: string) => {
    if (await lifecycle(jobId, { url: `/api/jobs/${jobId}/restore`, method: 'POST' })) void load();
  };
  const purgeJob = (jobId: string) => void lifecycle(jobId, { url: `/api/jobs/${jobId}?permanent=1`, method: 'DELETE' });

  const addColumn = async () => {
    if (!newColumnName.trim()) return;
    setError(null);
    try {
      const response = await fetch('/api/jobs/columns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newColumnName.trim() }),
      });
      const body = (await response.json().catch(() => ({}))) as { column?: JobColumnSummary; error?: string };
      if (!response.ok || !body.column) {
        setError(body.error ?? `HTTP ${response.status}`);
        return;
      }
      setColumns((current) => [...current, body.column!]);
      setNewColumnName('');
      setAddingColumn(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const renameColumn = async (columnId: string, name: string) => {
    setError(null);
    try {
      const response = await fetch(`/api/jobs/columns/${columnId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const body = (await response.json().catch(() => ({}))) as { column?: JobColumnSummary; error?: string };
      if (!response.ok || !body.column) {
        setError(body.error ?? `HTTP ${response.status}`);
        return;
      }
      setColumns((current) => current.map((column) => (column.id === columnId ? body.column! : column)));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const deleteColumn = async (columnId: string) => {
    setError(null);
    try {
      const response = await fetch(`/api/jobs/columns/${columnId}`, { method: 'DELETE' });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? `HTTP ${response.status}`);
        return;
      }
      setColumns((current) => current.filter((column) => column.id !== columnId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const onCreated = (created: JobSummary[]) => {
    setCreating(null);
    if (view === 'active') setJobs((current) => [...current, ...created]);
    setNotice(strings.jobs.createdJobs(created.length));
  };

  const addJob = async (columnId: string, title: string) => {
    setError(null);
    try {
      const response = await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, columnId }),
      });
      const body = (await response.json().catch(() => ({}))) as { job?: JobSummary; error?: string };
      if (!response.ok || !body.job) {
        setError(body.error ?? `HTTP ${response.status}`);
        return;
      }
      setJobs((current) => [...current, body.job!]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const reorderColumns = async (order: string[]) => {
    try {
      const response = await fetch('/api/jobs/columns', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? `HTTP ${response.status}`);
        await load();
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      await load();
    }
  };

  const moveJob = async (jobId: string, columnId: string, order: string[]) => {
    try {
      const response = await fetch(`/api/jobs/${jobId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ move: { columnId, order } }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? `HTTP ${response.status}`);
        await load();
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      await load();
    }
  };

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string);
    setDropTarget(null);
  };

  const handleDragOver = (event: DragOverEvent) => {
    const activeType = event.active.data.current?.type as string | undefined;
    if (activeType !== 'job') return;
    setDropTarget(computeJobDropTarget(event.active.id as string, event.over, jobs));
  };

  const handleDragCancel = () => {
    setActiveId(null);
    setDropTarget(null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);
    setDropTarget(null);
    if (!over || active.id === over.id) return;

    const activeType = active.data.current?.type as string | undefined;

    if (activeType === 'column') {
      if (over.data.current?.type !== 'column') return;
      const oldIndex = columns.findIndex((column) => column.id === active.id);
      const newIndex = columns.findIndex((column) => column.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return;
      const reordered = arrayMove(columns, oldIndex, newIndex);
      setColumns(reordered);
      void reorderColumns(reordered.map((column) => column.id));
      return;
    }

    if (activeType === 'job') {
      const activeJobId = active.id as string;
      const target = computeJobDropTarget(activeJobId, over, jobs);
      if (!target) return;
      const { columnId: destColumnId, index: insertIndex } = target;

      const destJobs = jobs
        .filter((job) => job.columnId === destColumnId && job.id !== activeJobId)
        .sort((a, b) => a.position - b.position)
        .map((job) => job.id);
      destJobs.splice(insertIndex, 0, activeJobId);

      setJobs((current) =>
        current.map((job) => {
          if (job.id === activeJobId) return { ...job, columnId: destColumnId, position: insertIndex };
          if (job.columnId === destColumnId) {
            const idx = destJobs.indexOf(job.id);
            return idx === -1 ? job : { ...job, position: idx };
          }
          return job;
        }),
      );

      void moveJob(activeJobId, destColumnId, destJobs);
    }
  };

  if (loading) return <p className="eve-dim">Carregando...</p>;

  if (error && columns.length === 0) {
    return (
      <div className="eve-empty">
        <p className="eve-alert eve-alert--error">{error}</p>
        <button type="button" className="eve-btn" onClick={() => void load()}>
          {strings.jobs.retry}
        </button>
      </div>
    );
  }

  if (columns.length === 0) {
    return (
      <div className="eve-jobs">
        <div className="eve-jobs__empty-board">
          {addingColumn ? (
            <div className="eve-jobs__add-form eve-jobs__empty-board__form">
              <input
                className="eve-input"
                autoFocus
                placeholder={strings.jobs.columnNamePlaceholder}
                value={newColumnName}
                onChange={(event) => setNewColumnName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void addColumn();
                  if (event.key === 'Escape') setAddingColumn(false);
                }}
              />
              <div className="eve-jobs__add-form-actions">
                <button type="button" className="eve-btn eve-btn--primary" onClick={() => void addColumn()}>
                  {strings.jobs.newColumn}
                </button>
                <button type="button" className="eve-btn" onClick={() => setAddingColumn(false)}>
                  {strings.edit.cancel}
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="eve-jobs__empty-board__plus"
              aria-label={strings.jobs.newColumn}
              title={strings.jobs.newColumn}
              onClick={() => setAddingColumn(true)}
            >
              +
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="eve-jobs">
      {error && (
        <p className="eve-alert eve-alert--error">
          {error} <button type="button" className="eve-btn" onClick={() => setError(null)}>{strings.edit.dismiss}</button>
        </p>
      )}

      {notice && (
        <p className="eve-alert">
          {notice} <button type="button" className="eve-btn" onClick={() => setNotice(null)}>{strings.edit.dismiss}</button>
        </p>
      )}

      <div className="eve-jobs__toolbar">
        <button type="button" className="eve-btn eve-btn--primary eve-jobs__add-button" onClick={() => setCreating({})}>
          <Plus size={16} aria-hidden="true" /> {strings.jobs.addJob}
        </button>

        {isAdmin && (
          <div className="eve-jobs__views" role="group" aria-label="Lista de jobs">
            {(['active', 'concluded', 'trash'] as const).map((option) => (
              <button key={option} type="button" aria-pressed={view === option} onClick={() => changeView(option)}>
                {option === 'active' ? strings.jobs.viewActive : option === 'concluded' ? strings.jobs.viewConcluded : strings.jobs.viewTrash}
              </button>
            ))}
          </div>
        )}

        <label className="eve-jobs__filter">
          <span className="eve-dim">Cliente</span>
          <select className="eve-input" value={clientFilter} aria-label="Filtrar jobs por cliente" onChange={(event) => setClientFilter(event.target.value)}>
            <option value="">Todos os clientes</option>
            {clientOptions.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
            {shownJobs.some((job) => !job.clientId) && <option value="__none__">Sem cliente</option>}
          </select>
        </label>
        <label className="eve-jobs__filter">
          <span className="eve-dim">{strings.jobs.filterResponsible}</span>
          <select className="eve-input" value={responsibleFilter} aria-label="Filtrar jobs por responsável" onChange={(event) => setResponsibleFilter(event.target.value)}>
            <option value="">{strings.jobs.everyone}</option>
            {members.map((member) => (
              <option key={member.id} value={member.id}>
                {memberLabel(member)}
              </option>
            ))}
            <option value="__none__">{strings.jobs.noResponsible}</option>
          </select>
        </label>
        <label className="eve-jobs__filter">
          <span className="eve-dim">{strings.jobs.filterInvolved}</span>
          <select className="eve-input" value={involvedFilter} aria-label="Filtrar jobs por envolvido" onChange={(event) => setInvolvedFilter(event.target.value)}>
            <option value="">{strings.jobs.everyone}</option>
            {members.map((member) => (
              <option key={member.id} value={member.id}>
                {memberLabel(member)}
              </option>
            ))}
          </select>
        </label>
        {hasFilter && (
          <button
            type="button"
            className="eve-btn"
            onClick={() => {
              setClientFilter('');
              setResponsibleFilter('');
              setInvolvedFilter('');
            }}
          >
            Limpar filtros
          </button>
        )}
        {manageMode && (
          <span className="eve-jobs__editing">
            Arraste os títulos das colunas para reordenar · clique direito em uma coluna para renomear, colorir ou apagar
            <button type="button" className="eve-btn eve-btn--primary" onClick={() => setManageMode(false)}>
              Concluir
            </button>
          </span>
        )}
      </div>

      {view !== 'active' ? (
        <JobsListView
          view={view}
          jobs={visibleListJobs}
          loading={listLoading}
          onOpen={setOpenJobId}
          onReopen={(jobId) => void reopenJob(jobId)}
          onRestore={(jobId) => void restoreJob(jobId)}
          onPurge={purgeJob}
        />
      ) : (
      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetectionStrategy}
        modifiers={[zoomAwareModifier]}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <SortableContext items={columns.map((column) => column.id)} strategy={horizontalListSortingStrategy}>
          <div
            className="eve-jobs__board"
            onContextMenu={(event) => {
              // Only the empty board itself — a card or column has its own behavior.
              if (event.target === event.currentTarget) menu.open(event, boardMenuItems().slice(1));
            }}
          >
            {columns.map((column) => (
              <BoardColumn
                key={column.id}
                column={column}
                jobs={jobsByColumn.get(column.id) ?? []}
                manageMode={manageMode}
                placeholderIndex={
                  dropTarget && dropTarget.columnId === column.id && activeJob?.columnId !== column.id
                    ? dropTarget.index
                    : null
                }
                onOpenJob={setOpenJobId}
                onAddJob={(columnId, title) => void addJob(columnId, title)}
                onContextMenu={(event, targetColumn) =>
                  menu.open(event, [
                    {
                      label: strings.jobs.renameColumn,
                      onSelect: () => {
                        const name = window.prompt(strings.jobs.renameColumn, targetColumn.name);
                        if (name && name.trim()) void renameColumn(targetColumn.id, name.trim());
                      },
                    },
                    {
                      label: strings.jobs.deleteColumn,
                      danger: true,
                      onSelect: () => void deleteColumn(targetColumn.id),
                    },
                    ...boardMenuItems(),
                  ])
                }
              />
            ))}

            {manageMode && (
              <div className="eve-jobs__column eve-jobs__column--new">
                {addingColumn ? (
                  <div className="eve-jobs__add-form">
                    <input
                      className="eve-input"
                      autoFocus
                      placeholder={strings.jobs.columnNamePlaceholder}
                      value={newColumnName}
                      onChange={(event) => setNewColumnName(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') void addColumn();
                        if (event.key === 'Escape') setAddingColumn(false);
                      }}
                    />
                    <div className="eve-jobs__add-form-actions">
                      <button type="button" className="eve-btn eve-btn--primary" onClick={() => void addColumn()}>
                        {strings.jobs.newColumn}
                      </button>
                      <button type="button" className="eve-btn" onClick={() => setAddingColumn(false)}>
                        {strings.edit.cancel}
                      </button>
                    </div>
                  </div>
                ) : (
                  <button type="button" className="eve-btn" onClick={() => setAddingColumn(true)}>
                    + {strings.jobs.newColumn}
                  </button>
                )}
              </div>
            )}
          </div>
        </SortableContext>

        <DragOverlay>
          {activeJob && <JobCardOverlay job={activeJob} />}
          {activeColumn && (
            <div className="eve-jobs__column">
              <div className="eve-jobs__column-head">
                <span>{activeColumn.name}</span>
              </div>
            </div>
          )}
        </DragOverlay>
      </DndContext>
      )}

      {menu.render()}

      {openJob && (
        <JobDetailModal
          job={openJob}
          members={members}
          currentUserId={currentUserId}
          isAdmin={isAdmin}
          runningEntry={runningEntry}
          onStartTimer={(taskId) => startTimer(openJob.id, taskId)}
          onStopTimer={stopTimer}
          onClose={() => setOpenJobId(null)}
          onJobChange={(updated) => {
            setJobs((current) => current.map((job) => (job.id === updated.id ? updated : job)));
            setListJobs((current) => current.map((job) => (job.id === updated.id ? updated : job)));
          }}
          onJobDeleted={(jobId) => {
            setJobs((current) => current.filter((job) => job.id !== jobId));
            setListJobs((current) => current.filter((job) => job.id !== jobId));
            setOpenJobId(null);
          }}
          onJobConcludedChange={(updated) => {
            setOpenJobId(null);
            if (updated.concludedAt) {
              setJobs((current) => current.filter((job) => job.id !== updated.id));
              setNotice(`${strings.jobs.conclude}: ${updated.title}`);
            } else {
              setListJobs((current) => current.filter((job) => job.id !== updated.id));
              void load();
            }
          }}
        />
      )}

      {creating && (
        <JobCreateModal
          columns={columns}
          members={members}
          initialColumnId={creating.columnId}
          initialTitle={creating.title}
          onClose={() => setCreating(null)}
          onCreated={onCreated}
        />
      )}
    </div>
  );
}
