import next from 'eslint-config-next';

/**
 * Flat config applied across the whole monorepo from the root.
 * `generated/` is Prisma output and must never be linted.
 * `.claude/` holds throwaway worktrees — whole copies of the repo, each with
 * its own node_modules — so linting it would lint the project several times over.
 */
const config = [
  {
    ignores: [
      '**/node_modules/**',
      '**/.next/**',
      '**/dist/**',
      '**/.turbo/**',
      '.claude/**',
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
