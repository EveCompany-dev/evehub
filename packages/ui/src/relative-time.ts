const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * "ha 3 min" — the footer line every widget shows.
 *
 * Takes `now` explicitly so it is testable and so server and client render the
 * same string (a hidden `Date.now()` here would cause hydration mismatches).
 */
export function formatRelativeTime(date: Date | string | null, now: number = Date.now()): string | null {
  if (!date) return null;

  const timestamp = typeof date === 'string' ? Date.parse(date) : date.getTime();
  if (Number.isNaN(timestamp)) return null;

  const elapsed = now - timestamp;

  if (elapsed < 0) return 'agora';
  if (elapsed < MINUTE) return 'agora';
  if (elapsed < HOUR) {
    const minutes = Math.floor(elapsed / MINUTE);
    return `ha ${minutes} min`;
  }
  if (elapsed < DAY) {
    const hours = Math.floor(elapsed / HOUR);
    return hours === 1 ? 'ha 1 hora' : `ha ${hours} horas`;
  }

  const days = Math.floor(elapsed / DAY);
  return days === 1 ? 'ha 1 dia' : `ha ${days} dias`;
}
