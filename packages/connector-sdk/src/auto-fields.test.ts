import { describe, expect, it } from 'vitest';
import { autoDetectFields } from './auto-fields';
import type { RemoteRecord } from './types';

describe('autoDetectFields', () => {
  it('returns nothing for an empty record set', () => {
    expect(autoDetectFields([])).toEqual([]);
  });

  it('infers a type per key from the first record and marks everything read-only', () => {
    const records: RemoteRecord[] = [
      {
        remoteId: 'r1',
        remoteVersion: '1',
        data: { client: 'Art Colchoes', spend: 1200, active: true, createdAt: '2026-01-05T10:00:00.000Z' },
      },
    ];

    expect(autoDetectFields(records)).toEqual([
      { key: 'client', label: 'Client', type: 'text', writable: false },
      { key: 'spend', label: 'Spend', type: 'number', writable: false },
      { key: 'active', label: 'Active', type: 'boolean', writable: false },
      { key: 'createdAt', label: 'CreatedAt', type: 'date', writable: false },
    ]);
  });

  it('caps at 6 fields, keeping the first record\'s key order', () => {
    const records: RemoteRecord[] = [
      { remoteId: 'r1', remoteVersion: '1', data: { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7 } },
    ];

    expect(autoDetectFields(records).map((field) => field.key)).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
  });
});
