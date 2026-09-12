import type { FieldSchema } from '@eve/connector-sdk';
import type { JSX } from 'react';
import type { WidgetRecord } from '../useWidgetData';

export interface StatCardsViewProps {
  fields: FieldSchema[];
  records: WidgetRecord[];
}

/**
 * One card per record, one stat per visible field. Generalizes what used to
 * be DemoWidget's hardcoded `pulse` tiles into a view any connector's fields
 * can use, read-only (editing stays table-only for now).
 */
export function StatCardsView({ fields, records }: StatCardsViewProps): JSX.Element {
  return (
    <div className="eve-cards">
      {records.map((record) => (
        <div className="eve-card eve-card--stat" key={record.remoteId}>
          {fields.map((field) => (
            <div className="eve-stat" key={field.key}>
              <span className="eve-stat__num">{String(record.data[field.key] ?? '—')}</span>
              <span className="eve-stat__label">{field.label}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
