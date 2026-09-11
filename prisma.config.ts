import path from 'node:path';
import 'dotenv/config';
import { defineConfig } from 'prisma/config';

// Prisma 7 nao carrega .env sozinho e nao le mais `package.json#prisma`.
// Schema, migrations, seed e a connection string do CLI moram aqui.
export default defineConfig({
  schema: path.join('infra', 'prisma', 'schema.prisma'),
  datasource: {
    url: process.env.DATABASE_URL ?? '',
  },
  migrations: {
    path: path.join('infra', 'prisma', 'migrations'),
    seed: 'tsx infra/prisma/seed.ts',
  },
});
