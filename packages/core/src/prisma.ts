import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '../generated/prisma';
import { getEnv } from './env';

// Explicit named re-exports rather than `export *`: the generated client is
// CommonJS, and a star re-export forces bundlers to resolve its exports at
// runtime instead of statically.
export { Prisma, PrismaClient };
export type {
  Attachment,
  Client,
  ClientSource,
  ConnectorInstance,
  DataTable,
  DataTableRow,
  EditLog,
  Job,
  JobCollaborator,
  JobColumn,
  JobComment,
  JobTask,
  Notification,
  NotificationType,
  PostPlatform,
  PostStatus,
  PostType,
  ScheduledPost,
  SyncRecord,
  SyncSnapshot,
  TimeEntry,
  User,
  Workspace,
} from '../generated/prisma';

// Next.js dev reloads modules on every edit; without this the process would
// open a new connection pool per reload until Postgres refuses new clients.
const globalForPrisma = globalThis as typeof globalThis & { evePrisma?: PrismaClient };

function getClient(): PrismaClient {
  if (!globalForPrisma.evePrisma) {
    const client = new PrismaClient({
      adapter: new PrismaPg({ connectionString: getEnv().DATABASE_URL }),
      log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
    });

    if (process.env.NODE_ENV === 'production') return client;
    globalForPrisma.evePrisma = client;
  }
  return globalForPrisma.evePrisma;
}

/**
 * Connects on first use, not on import.
 *
 * Importing `@eve/core` anywhere — a build step collecting route metadata, a
 * unit test, a CLI — must not require DATABASE_URL to be present or Postgres
 * to be reachable. Only actually running a query does.
 */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, property, receiver) {
    const client = getClient();
    const value = Reflect.get(client, property, receiver) as unknown;
    return typeof value === 'function' ? value.bind(client) : value;
  },
});
