'use client';

import type { FieldSchema } from '@eve/connector-sdk';
import type { JSX } from 'react';
import type { WidgetRecord } from '../useWidgetData';
import type { CellEditingApi } from './useCellEditing';

function renderValue(value: unknown, type: FieldSchema['type']): JSX.Element | string {
  if (type === 'boolean') return value ? '✓' : '—';
  const text = String(value ?? '');
  return text || <span className="eve-dim">&mdash;</span>;
}

export interface TableViewProps {
  fields: FieldSchema[];
  records: WidgetRecord[];
  editable: boolean;
  editing: CellEditingApi;
}

/**
 * The generic table renderer every connector widget uses: header + rows come
 * from `fields`/`records` (a plain `FieldSchema[]`/`WidgetRecord[]`, no
 * connector-specific typing), with an input shaped by `field.type` when a
 * writable field is being edited.
 */
export function TableView({ fields, records, editable, editing }: TableViewProps): JSX.Element {
  return (
    <div className="eve-table-wrap">
      <table className="eve-table">
        <thead>
          <tr>
            {fields.map((field) => (
              <th key={field.key}>{field.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {records.map((record) => (
            <tr key={record.remoteId}>
              {fields.map((field) => (
                <td key={field.key}>
                  {editing.editing && editable && field.writable ? (
                    <span className="eve-cell-edit eve-no-drag">
                      {field.type === 'boolean' ? (
                        <input
                          type="checkbox"
                          checked={editing.valueOf(record, field.key) === 'true'}
                          onChange={(event) => editing.setValue(record, field.key, String(event.target.checked))}
                        />
                      ) : field.options ? (
                        <select
                          className="eve-input"
                          value={editing.valueOf(record, field.key)}
                          onChange={(event) => editing.setValue(record, field.key, event.target.value)}
                        >
                          <option value="">—</option>
                          {field.options.map((option) => (
                            <option key={option} value={option}>
                              {option}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          className="eve-input"
                          type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'}
                          value={editing.valueOf(record, field.key)}
                          onChange={(event) => editing.setValue(record, field.key, event.target.value)}
                        />
                      )}
                    </span>
                  ) : (
                    renderValue(record.data[field.key], field.type)
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
