const TIME = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

const DATE_TIME = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

export function clockTime(value: string | Date): string {
  return TIME.format(new Date(value));
}

export function stamp(value: string | Date | null): string {
  if (!value) return '—';
  return DATE_TIME.format(new Date(value));
}

/** Durations read better with the unit that matches their magnitude. */
export function duration(milliseconds: number | null): string {
  if (milliseconds === null) return '—';
  if (milliseconds < 1000) return `${Math.round(milliseconds)}ms`;
  if (milliseconds < 60_000) return `${(milliseconds / 1000).toFixed(1)}s`;
  const minutes = Math.floor(milliseconds / 60_000);
  const seconds = Math.round((milliseconds % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}

/** Relative time, used for "down for 4m" and "next attempt in 12s". */
export function relative(value: string | null, now = Date.now()): string {
  if (!value) return '—';
  const delta = new Date(value).getTime() - now;
  const magnitude = duration(Math.abs(delta));
  return delta >= 0 ? `in ${magnitude}` : `${magnitude} ago`;
}

export function percent(ratio: number, digits = 1): string {
  return `${(ratio * 100).toFixed(digits)}%`;
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}
