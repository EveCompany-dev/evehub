/**
 * Registers every connector once, at server startup.
 *
 * Route handlers that only call into @eve/core (runSync, performWrite) never
 * import a connector package themselves — this guarantees the registry is
 * populated before the first request touches it.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./connectors');
  }
}
