'use client';

import { SettingsRow, SettingsSection, SettingsToggle, strings } from '@eve/ui';
import { useId, useState, type FormEvent, type JSX } from 'react';
import type { TodoListSummary } from '../../lib/todo-types';
import type { TodoSort } from './todo-order';

export interface TodoSettingsProps {
  lists: TodoListSummary[] | null;
  listId: string | null;
  onPickList: (id: string) => void;
  onCreateList: (name: string) => Promise<TodoListSummary | null>;
  onRenameList: (id: string, name: string) => Promise<boolean>;
  onDeleteList: (id: string) => Promise<boolean>;
  showCompleted: boolean;
  onShowCompletedChange: (next: boolean) => void;
  sort: TodoSort;
  onSortChange: (next: TodoSort) => void;
}

/** The Geral page of a Tarefas widget's settings card. */
export function TodoSettings({
  lists,
  listId,
  onPickList,
  onCreateList,
  onRenameList,
  onDeleteList,
  showCompleted,
  onShowCompletedChange,
  sort,
  onSortChange,
}: TodoSettingsProps): JSX.Element {
  const listSelectId = useId();
  const newListId = useId();
  const renameId = useId();
  const sortId = useId();
  const current = lists?.find((list) => list.id === listId) ?? null;

  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  // Keyed by list, so switching lists resets the field to that list's name.
  const [rename, setRename] = useState<{ id: string; value: string } | null>(null);
  const renameValue = rename && rename.id === current?.id ? rename.value : (current?.name ?? '');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const create = async (event: FormEvent) => {
    event.preventDefault();
    const name = newName.trim();
    if (!name || creating) return;
    setCreating(true);
    const list = await onCreateList(name);
    setCreating(false);
    if (list) {
      setNewName('');
      onPickList(list.id);
    }
  };

  const saveRename = async (event: FormEvent) => {
    event.preventDefault();
    const name = renameValue.trim();
    if (!current || !name || name === current.name) return;
    if (await onRenameList(current.id, name)) setRename(null);
  };

  const itemCount = current ? current.pendingCount + current.doneCount : 0;

  return (
    <>
      <SettingsSection title={strings.todo.listSection} description={strings.todo.listPickerHint}>
        {lists && lists.length > 0 ? (
          <SettingsRow label={strings.todo.listPicker} htmlFor={listSelectId}>
            <select
              id={listSelectId}
              className="eve-input"
              value={current?.id ?? ''}
              onChange={(event) => {
                setConfirmDelete(false);
                onPickList(event.target.value);
              }}
            >
              {lists.map((list) => (
                <option key={list.id} value={list.id}>
                  {list.name} ({list.pendingCount})
                </option>
              ))}
            </select>
          </SettingsRow>
        ) : (
          <p className="eve-dim">{strings.todo.noLists}</p>
        )}

        <SettingsRow label={strings.todo.newList} htmlFor={newListId} stacked>
          <form className="eve-todo__settings-form" onSubmit={(event) => void create(event)}>
            <input
              id={newListId}
              className="eve-input"
              placeholder={strings.todo.newListPlaceholder}
              value={newName}
              maxLength={80}
              onChange={(event) => setNewName(event.target.value)}
            />
            <button type="submit" className="eve-btn" disabled={!newName.trim() || creating}>
              {strings.todo.create}
            </button>
          </form>
        </SettingsRow>

        {current && (
          <SettingsRow label={strings.todo.renameList} htmlFor={renameId} stacked>
            <form className="eve-todo__settings-form" onSubmit={(event) => void saveRename(event)}>
              <input
                id={renameId}
                className="eve-input"
                value={renameValue}
                maxLength={80}
                onChange={(event) => setRename({ id: current.id, value: event.target.value })}
              />
              <button type="submit" className="eve-btn" disabled={!renameValue.trim() || renameValue.trim() === current.name}>
                {strings.todo.save}
              </button>
            </form>
          </SettingsRow>
        )}

        {current && (
          <SettingsRow
            label={strings.todo.deleteList}
            hint={confirmDelete ? strings.todo.deleteListConfirm(current.name, itemCount) : undefined}
          >
            {confirmDelete ? (
              <>
                <button type="button" className="eve-btn" onClick={() => setConfirmDelete(false)}>
                  {strings.todo.deleteNo}
                </button>
                <button
                  type="button"
                  className="eve-btn eve-btn--danger-solid"
                  autoFocus
                  onClick={() => {
                    setConfirmDelete(false);
                    void onDeleteList(current.id);
                  }}
                >
                  {strings.todo.deleteYes}
                </button>
              </>
            ) : (
              <button type="button" className="eve-btn eve-btn--danger" onClick={() => setConfirmDelete(true)}>
                {strings.todo.deleteList}
              </button>
            )}
          </SettingsRow>
        )}
      </SettingsSection>

      <SettingsSection title={strings.todo.displaySection}>
        <SettingsToggle
          label={strings.todo.showCompleted}
          hint={strings.todo.showCompletedHint}
          checked={showCompleted}
          onChange={onShowCompletedChange}
        />
        <SettingsRow label={strings.todo.sort} htmlFor={sortId}>
          <select id={sortId} className="eve-input" value={sort} onChange={(event) => onSortChange(event.target.value as TodoSort)}>
            <option value="manual">{strings.todo.sortManual}</option>
            <option value="pending-first">{strings.todo.sortPendingFirst}</option>
          </select>
        </SettingsRow>
      </SettingsSection>
    </>
  );
}
