/**
 * Registers every connector once, at server startup.
 *
 * Route handlers that only call into @eve/core (runSync, performWrite) never
 * import a connector package themselves — this guarantees the registry is
 * populated before the first request touches it. It also validates the
 * environment up front (packages/core/src/env.ts).
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Fail the boot, not the first request: a production server missing its
    // public address or login domain must not come up at all.
    // Next only logs a throw from here and keeps serving, so exit instead.
    if (process.env.NEXT_PHASE !== 'phase-production-build') {
      const { getEnv } = await import('@eve/core');
      try {
        getEnv();
      } catch (error) {
        console.error(error instanceof Error ? error.message : error);
        process.exit(1);
      }
    }
    await import('./connectors');
  }
}
