import { createHash } from 'node:crypto';

export interface HooklineEvent {
  readonly id: string;
  readonly tenantId: string;
  readonly type: string;
  readonly payload: unknown;
  readonly partitionKey: string | null;
  readonly idempotencyKey: string | null;
  readonly payloadFingerprint: string;
  readonly source: string | null;
  readonly occurredAt: Date;
  readonly createdAt: Date;
}

/**
 * Identifies the content of an event independently of its key.
 *
 * JSON.stringify is not canonical - `{a:1,b:2}` and `{b:2,a:1}` serialize differently - so object
 * keys are sorted before hashing. Without that, a client that rebuilds the same payload from a map
 * could see its own retry rejected as a mismatched idempotency key.
 */
export function fingerprintEvent(input: {
  type: string;
  payload: unknown;
  partitionKey: string | null;
}): string {
  const canonical = JSON.stringify({
    type: input.type,
    partitionKey: input.partitionKey,
    payload: canonicalize(input.payload),
  });
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }
  return value;
}
