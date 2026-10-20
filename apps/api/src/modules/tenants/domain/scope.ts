/**
 * Scopes keep publishing credentials separate from administrative ones: the service that emits
 * events only needs `events:write`, so a leaked publisher key cannot repoint a destination.
 */
export const SCOPES = [
  'events:write',
  'endpoints:read',
  'endpoints:write',
  'deliveries:read',
  'deliveries:replay',
] as const;

export type Scope = (typeof SCOPES)[number];

export function isScope(value: string): value is Scope {
  return (SCOPES as readonly string[]).includes(value);
}

/** Scopes granted to the console key bundled with the demonstration data. */
export const CONSOLE_SCOPES: readonly Scope[] = [
  'endpoints:read',
  'endpoints:write',
  'deliveries:read',
  'deliveries:replay',
  'events:write',
];

export const PUBLISHER_SCOPES: readonly Scope[] = ['events:write'];
