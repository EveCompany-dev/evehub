import './load-env';
// Registering connectors must happen before any job runs.
import '@eve/connector-calculator';
import '@eve/connector-calendar';
import '@eve/connector-chat';
import '@eve/connector-demo';
import '@eve/connector-google-ads';
import '@eve/connector-google-calendar';
import '@eve/connector-meta';
import '@eve/connector-notes';
import '@eve/connector-notion';
import '@eve/connector-overview';
import '@eve/connector-timer';
import '@eve/connector-todo';

import { getEnv, prisma, pruneSnapshots, runSync } from '@eve/core';
import { requireConnector } from '@eve/connector-sdk';
import { Queue, Worker, type Job } from 'bullmq';
import IORedis from 'ioredis';
import { randomUUID } from 'node:crypto';
import { cleanupPublishedMedia } from './media-cleanup';
import { processDuePosts } from './scheduling';
import { reconcileSyncSchedulers, SYNC_SCHEDULER_PREFIX } from './sync-schedulers';

// BullMQ 6 rejects ':' in queue names (it is their key separator).
const SYNC_QUEUE = 'eve-sync';
const PRUNE_JOB = 'prune-snapshots';
const MEDIA_CLEANUP_JOB = 'media-cleanup';
/**
 * Publishing has its own queue and its own worker at concurrency 1: one tick
 * at a time, and never stuck behind (or rate-limited with) connector syncs.
 */
const SCHEDULING_QUEUE = 'eve-scheduling';
const SCHEDULING_JOB = 'scheduling-tick';
const SCHEDULING_INTERVAL_MS = 60_000;
const RECONCILE_INTERVAL_MS = 5 * 60_000;

/**
 * Read by the web app (GET /api/scheduling/worker-status): missing means no
 * worker has ticked in the last HEARTBEAT_TTL_S, and the UI warns that posts
 * will not go out.
 */
const HEARTBEAT_KEY = 'eve:worker:heartbeat';
const HEARTBEAT_TTL_S = 300;
/**
 * Second guard next to concurrency 1: two worker processes (an old one still
 * draining during a deploy, say) never run a tick at the same time. Each post
 * is also claimed on its own, so this is about not doing the work twice, not
 * about correctness.
 */
const TICK_LOCK_KEY = 'eve:scheduling:tick-lock';
const TICK_LOCK_MS = 15 * 60_000;

interface SyncJobData {
  instanceId: string;
}

const env = getEnv();
const connection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });

const queue = new Queue<SyncJobData>(SYNC_QUEUE, { connection });
const schedulingQueue = new Queue(SCHEDULING_QUEUE, { connection });

/**
 * Spreads scheduled syncs across the interval instead of firing every
 * connector in the same second, which would burst straight into the Meta and
 * Google rate limits once there are a dozen instances.
 */
function jitter(intervalMs: number): number {
  return Math.floor(Math.random() * Math.min(60_000, intervalMs * 0.2));
}

async function upsertSyncScheduler(instanceId: string): Promise<void> {
  await queue.upsertJobScheduler(
    `${SYNC_SCHEDULER_PREFIX}${instanceId}`,
    { every: env.SYNC_INTERVAL_MS, offset: jitter(env.SYNC_INTERVAL_MS) },
    {
      name: 'sync',
      data: { instanceId },
      opts: {
        attempts: 5,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: { count: 50 },
        removeOnFail: { count: 200 },
      },
    },
  );
}

/** Adds syncs for new instances and drops the ones for deleted or disabled instances. */
async function reconcileSyncs(): Promise<void> {
  const instances = await prisma.connectorInstance.findMany({ where: { status: { not: 'disabled' } }, select: { id: true } });
  const { added, removed } = await reconcileSyncSchedulers(
    queue,
    instances.map((instance) => instance.id),
    upsertSyncScheduler,
  );
  if (added.length || removed.length) console.log(`[worker] syncs: ${added.length} adicionada(s), ${removed.length} removida(s)`);
}

async function scheduleAll(): Promise<void> {
  await reconcileSyncs();

  await queue.upsertJobScheduler(
    PRUNE_JOB,
    { every: 24 * 60 * 60 * 1000 },
    { name: PRUNE_JOB, data: { instanceId: PRUNE_JOB }, opts: { removeOnComplete: { count: 5 } } },
  );

  await queue.upsertJobScheduler(
    MEDIA_CLEANUP_JOB,
    { every: 24 * 60 * 60 * 1000 },
    { name: MEDIA_CLEANUP_JOB, data: { instanceId: MEDIA_CLEANUP_JOB }, opts: { removeOnComplete: { count: 5 } } },
  );

  // The tick used to live on the sync queue; a Redis that still has that
  // scheduler would keep firing it there.
  await queue.removeJobScheduler(SCHEDULING_JOB);
  await schedulingQueue.upsertJobScheduler(
    SCHEDULING_JOB,
    { every: SCHEDULING_INTERVAL_MS },
    { name: SCHEDULING_JOB, data: {}, opts: { removeOnComplete: { count: 20 }, removeOnFail: { count: 50 } } },
  );

  const count = await prisma.connectorInstance.count({ where: { status: { not: 'disabled' } } });
  console.log(`[worker] ${count} instancia(s) agendada(s) a cada ${env.SYNC_INTERVAL_MS / 1000}s`);
}

async function beat(): Promise<void> {
  try {
    await connection.set(HEARTBEAT_KEY, new Date().toISOString(), 'EX', HEARTBEAT_TTL_S);
  } catch (error) {
    console.error('[worker] falha ao gravar o heartbeat:', error instanceof Error ? error.message : error);
  }
}

// Releases the lock only if it is still ours (it may have expired and been taken).
const RELEASE_LOCK = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";

async function runSchedulingTick(): Promise<void> {
  await beat();
  const token = randomUUID();
  const locked = await connection.set(TICK_LOCK_KEY, token, 'PX', TICK_LOCK_MS, 'NX');
  if (locked !== 'OK') return;
  try {
    const { published, failed, processing, facebookFeedChecked } = await processDuePosts({ onProgress: beat });
    if (published || failed || processing) {
      console.log(`[worker] agenda: ${published} publicado(s), ${failed} com falha, ${processing} ainda processando; ${facebookFeedChecked} do Facebook conferido(s)`);
    }
  } finally {
    await connection.eval(RELEASE_LOCK, 1, TICK_LOCK_KEY, token).catch(() => undefined);
  }
}

const worker = new Worker<SyncJobData>(
  SYNC_QUEUE,
  async (job: Job<SyncJobData>) => {
    if (job.name === PRUNE_JOB) {
      const removed = await pruneSnapshots(env.SNAPSHOT_RETENTION_DAYS);
      console.log(`[worker] retencao: ${removed} snapshot(s) removido(s)`);
      return;
    }

    if (job.name === MEDIA_CLEANUP_JOB) {
      const removed = await cleanupPublishedMedia();
      if (removed) console.log(`[worker] limpeza de midia: ${removed} arquivo(s) de posts ja publicados removido(s)`);
      return;
    }

    // A stale tick job still queued here from before the scheduling queue existed.
    if (job.name === SCHEDULING_JOB) return;

    const result = await runSync(job.data.instanceId);

    if (!result.ok) {
      // Throwing hands the job back to BullMQ's exponential backoff. After the
      // final attempt the instance is already marked `error` with a message,
      // so the failure shows up in the UI on its own.
      throw new Error(result.error ?? 'sync falhou');
    }

    console.log(`[worker] sync ok: ${job.data.instanceId} (${result.recordCount ?? 0} registros)`);
  },
  {
    connection,
    concurrency: 4,
    // Respects the tightest rate limit any connector declares. Per-connector
    // limiting arrives with the first API that actually needs it.
    limiter: { max: 30, duration: 60_000 },
  },
);

const schedulingWorker = new Worker(SCHEDULING_QUEUE, async () => runSchedulingTick(), { connection, concurrency: 1 });

worker.on('failed', (job, error) => {
  console.error(`[worker] job ${job?.id ?? '?'} falhou:`, error.message);
});
schedulingWorker.on('failed', (job, error) => {
  console.error(`[worker] tick ${job?.id ?? '?'} falhou:`, error.message);
});

let reconcileTimer: NodeJS.Timeout | undefined;

async function main(): Promise<void> {
  // Fails fast at boot if an instance points at a connector nobody registered.
  const instances = await prisma.connectorInstance.findMany({ select: { connectorId: true }, distinct: ['connectorId'] });
  for (const { connectorId } of instances) {
    try {
      requireConnector(connectorId);
    } catch {
      console.warn(`[worker] aviso: instancia usa connector "${connectorId}", que nao esta registrado neste build.`);
    }
  }

  await scheduleAll();
  await beat();
  reconcileTimer = setInterval(() => {
    reconcileSyncs().catch((error: unknown) => console.error('[worker] falha ao reconciliar as syncs:', error instanceof Error ? error.message : error));
  }, RECONCILE_INTERVAL_MS);
  console.log('[worker] pronto.');
}

async function shutdown(signal: string): Promise<void> {
  console.log(`[worker] ${signal} recebido, encerrando...`);
  clearInterval(reconcileTimer);
  // close() waits for the running job: a post mid-publish gets to finish.
  await Promise.all([worker.close(), schedulingWorker.close()]);
  await Promise.all([queue.close(), schedulingQueue.close()]);
  await connection.quit();
  await prisma.$disconnect();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

main().catch((error: unknown) => {
  console.error('[worker] falha na inicializacao:', error);
  process.exit(1);
});
