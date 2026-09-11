import next from 'eslint-config-next';

/**
 * Flat config applied across the whole monorepo from the root.
 * `generated/` is Prisma output and must never be linted.
 */
const config = [
  {
    ignores: [
      '**/node_modules/**',
      '**/.next/**',
      '**/dist/**',
      '**/.turbo/**',
      'packages/core/generated/**',
      'infra/prisma/migrations/**',
    ],
  },
  ...(Array.isArray(next) ? next : [next]),
  {
    // The Next plugin looks for a pages/ directory relative to the lint root.
    settings: { next: { rootDir: 'apps/web' } },
  },
];

export default config;
