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
import { strings } from '@eve/ui';
import { useSearchParams } from 'next/navigation';
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type JSX,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { useContextMenu } from './ContextMenu';
import { JobDetailModal } from './JobDetailModal';
import { memberInitials, memberLabel, type JobColumnSummary, type JobMember, type JobSummary } from './job-types';
import { useTimer } from './TimerProvider';

export interface JobsBoardProps {
  currentUserId: string;
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

function GearIcon(): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2" />
      <path
        d="M19.4 13a7.97 7.97 0 0 0 0-2l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.9 7.9 0 0 0-1.73-1l-.36-2.54a.5.5 0 0 0-.5-.43h-3.84a.5.5 0 0 0-.5.43l-.36 2.54a7.9 7.9 0 0 0-1.73 1l-2.39-.96a.5.5 0 0 0-.6.22L2.7 8.78a.5.5 0 0 0 .12.64L4.85 11a7.97 7.97 0 0 0 0 2l-2.03 1.58a.5.5 0 0 0-.12.64l1.92 3.32a.5.5 0 0 0 .6.22l2.39-.96a7.9 7.9 0 0 0 1.73 1l.36 2.54a.5.5 0 0 0 .5.43h3.84a.5.5 0 0 0 .5-.43l.36-2.54a7.9 7.9 0 0 0 1.73-1l2.39.96a.5.5 0 0 0 .6-.22l1.92-3.32a.5.5 0 0 0-.12-.64L19.4 13Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

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
        {dueDate && <span className="eve-job-card__due">{dueDate}</span>}
        {job.tasks.length > 0 && (
          <span className="eve-job-card__tasks">
            {doneCount}/{job.tasks.length}
          </span>
        )}
      </div>
      {job.collaborators.length > 0 && (
        <div className="eve-job-card__avatars">
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
        {...(manageMode ? attributes : {})}
        {...(manageMode ? listeners : {})}
        onContextMenu={(event) => {
          if (manageMode) onContextMenu(event, column);
        }}
      >
        <span>{column.name}</span>
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

export function JobsBoard({ currentUserId }: JobsBoardProps): JSX.Element {
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

  // Deep-link from a notification ("...?job=<id>"): open it once the board
  // has loaded, but only the first time it appears — closing the modal
  // afterward shouldn't keep reopening it while the query param is still in
  // the URL. Adjusting state during render (per
  // https://react.dev/learn/you-might-not-need-an-effect) rather than an
  // effect, since it's derived purely from data already available here.
  const deepLinkJobId = useSearchParams().get('job');
  const [deepLinkApplied, setDeepLinkApplied] = useState(false);
  if (deepLinkJobId && !deepLinkApplied && jobs.some((job) => job.id === deepLinkJobId)) {
    setOpenJobId(deepLinkJobId);
    setDeepLinkApplied(true);
  }

  const jobsByColumn = useMemo(() => {
    const map = new Map<string, JobSummary[]>();
    for (const column of columns) map.set(column.id, []);
    for (const job of [...jobs].sort((a, b) => a.position - b.position)) {
      const list = map.get(job.columnId);
      if (list) list.push(job);
    }
    return map;
  }, [columns, jobs]);

  const activeJob = activeId ? jobs.find((job) => job.id === activeId) ?? null : null;
  const activeColumn = activeId ? columns.find((column) => column.id === activeId) ?? null : null;
  const openJob = openJobId ? jobs.find((job) => job.id === openJobId) ?? null : null;

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

      <div className="eve-jobs__toolbar">
        <button
          type="button"
          className={manageMode ? 'eve-btn eve-btn--icon is-active' : 'eve-btn eve-btn--icon'}
          aria-pressed={manageMode}
          aria-label={strings.jobs.manageColumns}
          title={strings.jobs.manageColumns}
          onClick={() => setManageMode((value) => !value)}
        >
          <GearIcon />
        </button>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetectionStrategy}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <SortableContext items={columns.map((column) => column.id)} strategy={horizontalListSortingStrategy}>
          <div className="eve-jobs__board">
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

      {menu.render()}

      {openJob && (
        <JobDetailModal
          job={openJob}
          members={members}
          currentUserId={currentUserId}
          runningEntry={runningEntry}
          onStartTimer={(taskId) => startTimer(openJob.id, taskId)}
          onStopTimer={stopTimer}
          onClose={() => setOpenJobId(null)}
          onJobChange={(updated) => setJobs((current) => current.map((job) => (job.id === updated.id ? updated : job)))}
          onJobDeleted={(jobId) => {
            setJobs((current) => current.filter((job) => job.id !== jobId));
            setOpenJobId(null);
          }}
        />
      )}
    </div>
  );
}
