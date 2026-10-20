export type ReceiverMode = 'ok' | 'error' | 'offline';

export interface Behaviour {
  /**
   * `ok` answers 2xx, `error` always fails, and `offline` stops listening entirely so connections
   * are refused. The last one matters: a destination that is genuinely down produces
   * `connection_refused`, which is a different failure from one that answers 503, and the sender
   * should be seen handling both.
   */
  readonly mode: ReceiverMode;
  /** Artificial delay before answering, in milliseconds. */
  readonly latencyMs: number;
  /** Probability of failing while in `ok` mode, for rehearsing an intermittent destination. */
  readonly failureRate: number;
  /** Status returned when failing. */
  readonly statusCode: number;
  /** Sent as `Retry-After` on a failure, which the sender is expected to honour. */
  readonly retryAfterSeconds: number | null;
  /** When false, requests are accepted without checking the signature. */
  readonly verifySignature: boolean;
}

export const DEFAULT_BEHAVIOUR: Behaviour = {
  mode: 'ok',
  latencyMs: 0,
  failureRate: 0,
  statusCode: 503,
  retryAfterSeconds: null,
  verifySignature: true,
};

export const MAX_LATENCY_MS = 30_000;

export class BehaviourError extends Error {}

/**
 * Validates a partial behaviour update. The receiver is a test fixture, but a fixture that accepts
 * nonsense silently is a fixture that wastes an afternoon: every field is checked and the
 * rejection names what was wrong.
 */
export function mergeBehaviour(current: Behaviour, patch: unknown): Behaviour {
  if (patch === null || typeof patch !== 'object')
    throw new BehaviourError('The request body must be a JSON object.');
  const input = patch as Record<string, unknown>;
  const next = { ...current };

  if ('mode' in input) {
    if (input.mode !== 'ok' && input.mode !== 'error' && input.mode !== 'offline')
      throw new BehaviourError('mode must be "ok", "error" or "offline".');
    next.mode = input.mode;
  }
  if ('latencyMs' in input) {
    const value = Number(input.latencyMs);
    if (!Number.isInteger(value) || value < 0 || value > MAX_LATENCY_MS)
      throw new BehaviourError(`latencyMs must be an integer between 0 and ${MAX_LATENCY_MS}.`);
    next.latencyMs = value;
  }
  if ('failureRate' in input) {
    const value = Number(input.failureRate);
    if (!Number.isFinite(value) || value < 0 || value > 1)
      throw new BehaviourError('failureRate must be between 0 and 1.');
    next.failureRate = value;
  }
  if ('statusCode' in input) {
    const value = Number(input.statusCode);
    if (!Number.isInteger(value) || value < 400 || value > 599)
      throw new BehaviourError('statusCode must be an integer between 400 and 599.');
    next.statusCode = value;
  }
  if ('retryAfterSeconds' in input) {
    if (input.retryAfterSeconds === null) next.retryAfterSeconds = null;
    else {
      const value = Number(input.retryAfterSeconds);
      if (!Number.isInteger(value) || value < 0 || value > 3600)
        throw new BehaviourError('retryAfterSeconds must be null or an integer up to 3600.');
      next.retryAfterSeconds = value;
    }
  }
  if ('verifySignature' in input) {
    if (typeof input.verifySignature !== 'boolean')
      throw new BehaviourError('verifySignature must be a boolean.');
    next.verifySignature = input.verifySignature;
  }

  return next;
}

/** Whether this particular request should fail, given the behaviour. */
export function shouldFail(behaviour: Behaviour, random: () => number = Math.random): boolean {
  if (behaviour.mode === 'error') return true;
  if (behaviour.failureRate <= 0) return false;
  return random() < behaviour.failureRate;
}
