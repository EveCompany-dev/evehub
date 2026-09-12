import type { EveConnector, FieldSchema, RemoteRecord, SyncResult, WritePatch, WriteResult } from '@eve/connector-sdk';
import { registerConnector } from '@eve/connector-sdk';
import { z } from 'zod';
import { DEMO_STATUSES, EDITABLE_FIELDS } from './shared';
import { getDemoStore, type DemoRecord } from './store';


const configSchema = z.object({
  clientCount: z.number().int().min(1).max(20).default(6),
  seed: z.string().min(1).default('evecompany'),
});

export type DemoConfig = z.infer<typeof configSchema>;

const CLIENT_NAMES = [
  'Art Colchoes',
  'Classe Moveis',
  'Premium Machine',
  'Bella Casa',
  'Studio Norte',
  'Oficina Central',
  'Verde Vivo',
  'Casa & Cia',
  'Forte Log',
  'Lumine',
  'Acqua Sul',
  'Nova Rota',
  'Ponto Certo',
  'Rio Bonito',
  'Sete Mares',
  'Terra Firme',
  'Urbano Lar',
  'Vale Verde',
  'Wolf Auto',
  'Zenite',
] as const;

const OWNERS = ['Marcele', 'Shelly', 'Ma', 'Time'] as const;

/** FNV-1a, so the same seed always produces the same demo workspace. */
function hashSeed(seed: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedRecords(config: DemoConfig): DemoRecord[] {
  const random = mulberry32(hashSeed(config.seed));

  return Array.from({ length: config.clientCount }, (_, index) => {
    const name = CLIENT_NAMES[index % CLIENT_NAMES.length] ?? `Cliente ${index + 1}`;
    const owner = OWNERS[Math.floor(random() * OWNERS.length)] ?? 'Time';
    const status = DEMO_STATUSES[Math.floor(random() * DEMO_STATUSES.length)] ?? 'Ativo';

    return {
      id: `demo-${index + 1}`,
      version: '1',
      fields: {
        client: name,
        status,
        owner,
        notes: '',
        // Read-only upstream metrics, stable so edits do not fight with syncs.
        spend: Math.round(random() * 8000 + 500),
        leads: Math.round(random() * 120 + 5),
      },
    } satisfies DemoRecord;
  });
}

async function ensureSeeded(instanceId: string, config: DemoConfig): Promise<DemoRecord[]> {
  const store = getDemoStore();
  const existing = await store.load(instanceId);
  if (existing && existing.length === config.clientCount) return existing;

  const seeded = seedRecords(config);
  await store.save(instanceId, seeded);
  return seeded;
}

function toRemoteRecord(record: DemoRecord): RemoteRecord {
  return { remoteId: record.id, remoteVersion: record.version, data: record.fields };
}

export const demoConnector: EveConnector<DemoConfig> = registerConnector<DemoConfig, undefined>({
  id: 'demo',
  label: 'Demonstracao',
  description:
    'Fonte de dados falsa que implementa o contrato inteiro do SDK. Serve de referencia para novos connectors e permite testar sync, escrita, conflito e undo sem nenhuma credencial.',
  auth: 'none',
  capabilities: { read: true, write: true, webhook: false },
  rateLimit: { max: 60, windowMs: 60_000 },
  defaultSize: { w: 7, h: 8, minW: 4, minH: 5 },
  configSchema,
  defaultConfig: { clientCount: 6, seed: 'evecompany' },

  describeFields(): FieldSchema[] {
    return [
      { key: 'client', label: 'Cliente', type: 'text', writable: false },
      { key: 'status', label: 'Status', type: 'select', writable: true, options: [...DEMO_STATUSES] },
      { key: 'owner', label: 'Responsavel', type: 'text', writable: true },
      { key: 'notes', label: 'Obs.', type: 'text', writable: true },
      { key: 'spend', label: 'Invest.', type: 'number', writable: false },
      { key: 'leads', label: 'Leads', type: 'number', writable: false },
    ];
  },

  async sync(ctx): Promise<SyncResult> {
    const records = await ensureSeeded(ctx.instanceId, ctx.config);

    // `pulse` changes on every sync while record versions stay put. That is
    // what makes live updates visible in the UI without manufacturing edit
    // conflicts against anyone who happens to have the widget open.
    const minuteOfDay = Math.floor(Date.now() / 60_000) % 1440;
    const wave = Math.sin(minuteOfDay / 40);

    return {
      ok: true,
      data: {
        generatedAt: new Date().toISOString(),
        clientCount: records.length,
        pulse: {
          impressions: Math.round(42_000 + wave * 9_000),
          ctr: Number((2.4 + wave * 0.6).toFixed(2)),
          activeCampaigns: records.filter((r) => r.fields.status === 'Ativo').length,
        },
      },
      records: records.map(toRemoteRecord),
    };
  },

  async write(ctx, patch: WritePatch): Promise<WriteResult> {
    const store = getDemoStore();
    const records = await ensureSeeded(ctx.instanceId, ctx.config);
    const index = records.findIndex((record) => record.id === patch.remoteId);

    if (index === -1) return { ok: false, error: `Registro "${patch.remoteId}" nao existe.` };

    const current = records[index];
    if (!current) return { ok: false, error: `Registro "${patch.remoteId}" nao existe.` };

    if (current.version !== patch.expectedVersion) {
      return { ok: false, conflict: true, currentVersion: current.version, currentData: current.fields };
    }

    for (const [field, value] of Object.entries(patch.patch)) {
      if (!(EDITABLE_FIELDS as readonly string[]).includes(field)) {
        return { ok: false, error: `O campo "${field}" e somente leitura.` };
      }
      if (field === 'status' && !(DEMO_STATUSES as readonly string[]).includes(String(value))) {
        return { ok: false, error: `Status invalido: "${String(value)}".` };
      }
      if (typeof value !== 'string') {
        return { ok: false, error: `O campo "${field}" espera texto.` };
      }
    }

    const updated: DemoRecord = {
      ...current,
      version: String(Number(current.version) + 1),
      fields: { ...current.fields, ...patch.patch },
    };

    records[index] = updated;
    await store.save(ctx.instanceId, records);

    return { ok: true, newVersion: updated.version, data: updated.fields };
  },

  async readVersion(ctx, remoteId): Promise<string | null> {
    const records = await ensureSeeded(ctx.instanceId, ctx.config);
    return records.find((record) => record.id === remoteId)?.version ?? null;
  },
});
