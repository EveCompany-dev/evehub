import './load-env';
// Registering connectors must happen before any job runs.
import '@eve/connector-calculator';
import '@eve/connector-calendar';
import '@eve/connector-chat';
import '@eve/connector-demo';
import '@eve/connector-meta';
import '@eve/connector-notes';
import '@eve/connector-notion';
import '@eve/connector-overview';

import { getEnv, prisma, pruneSnapshots, runSync, touchWorkerHeartbeat } from '@eve/core';
import { requireConnector } from '@eve/connector-sdk';
import { Queue, Worker, type Job } from 'bullmq';
import IORedis from 'ioredis';
import { cleanupPublishedMedia } from './media-cleanup';
import { processDuePosts } from './scheduling';

// BullMQ 6 rejects ':' in queue names (it is their key separator).
const SYNC_QUEUE = 'eve-sync';
const PRUNE_JOB = 'prune-snapshots';
const MEDIA_CLEANUP_JOB = 'media-cleanup';
const SCHEDULING_JOB = 'scheduling-tick';
const SCHEDULING_INTERVAL_MS = 60_000;

interface SyncJobData {
  instanceId: string;
}

const env = getEnv();
const connection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });

const queue = new Queue<SyncJobData>(SYNC_QUEUE, { connection });

/**
 * Spreads scheduled syncs across the interval instead of firing every
 * connector in the same second, which would burst straight into the Meta and
 * Google rate limits once there are a dozen instances.
 */
function jitter(intervalMs: number): number {
  return Math.floor(Math.random() * Math.min(60_000, intervalMs * 0.2));
}

async function scheduleAll(): Promise<void> {
  const instances = await prisma.connectorInstance.findMany({
    where: { status: { not: 'disabled' } },
    select: { id: true, connectorId: true, label: true },
  });

  for (const instance of instances) {
    await queue.upsertJobScheduler(
      `sync-${instance.id}`,
      { every: env.SYNC_INTERVAL_MS, offset: jitter(env.SYNC_INTERVAL_MS) },
      {
        name: 'sync',
        data: { instanceId: instance.id },
        opts: {
          attempts: 5,
          backoff: { type: 'exponential', delay: 5_000 },
          removeOnComplete: { count: 50 },
          removeOnFail: { count: 200 },
        },
      },
    );
  }

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

  await queue.upsertJobScheduler(
    SCHEDULING_JOB,
    { every: SCHEDULING_INTERVAL_MS },
    { name: SCHEDULING_JOB, data: { instanceId: SCHEDULING_JOB }, opts: { removeOnComplete: { count: 20 } } },
  );

  console.log(`[worker] ${instances.length} instancia(s) agendada(s) a cada ${env.SYNC_INTERVAL_MS / 1000}s`);
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

    if (job.name === SCHEDULING_JOB) {
      const { published, failed, processing, recovered } = await processDuePosts();
      if (published || failed || processing || recovered) {
        console.log(
          `[worker] agenda: ${published} publicado(s), ${failed} com falha, ${processing} ainda processando, ${recovered} recuperado(s) de publish interrompido`,
        );
      }
      return;
    }

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

worker.on('failed', (job, error) => {
  console.error(`[worker] job ${job?.id ?? '?'} falhou:`, error.message);
});

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
  // Before the first tick, so the app stops warning that publishing is down
  // the moment this process is actually up.
  await touchWorkerHeartbeat();
  console.log('[worker] pronto.');
}

async function shutdown(signal: string): Promise<void> {
  console.log(`[worker] ${signal} recebido, encerrando...`);
  await worker.close();
  await queue.close();
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
