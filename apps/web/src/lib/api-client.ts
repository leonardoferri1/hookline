import 'server-only';
import { readApiKey } from './session';

export const API_BASE = process.env.HOOKLINE_API_URL?.replace(/\/$/, '') ?? 'http://127.0.0.1:3021';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly problem?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export class NotConnectedError extends Error {
  constructor() {
    super('No API key in this session.');
    this.name = 'NotConnectedError';
  }
}

interface RequestOptions {
  readonly method?: string;
  readonly body?: unknown;
  readonly apiKey?: string;
  readonly idempotencyKey?: string;
  readonly query?: Record<string, string | number | string[] | undefined>;
}

/**
 * Server-side client for the delivery API.
 *
 * Everything the console shows is fetched here rather than in the browser, which keeps the API key
 * on the server and means the console never needs CORS or a public API surface of its own. The
 * API's RFC 9457 problem documents are turned into `ApiError`, so a page can branch on a stable
 * code instead of parsing a message.
 */
export async function callApi<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const apiKey = options.apiKey ?? (await readApiKey());
  if (!apiKey) throw new NotConnectedError();

  const url = new URL(`${API_BASE}/api/v1${path}`);
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value === undefined) continue;
    if (Array.isArray(value)) for (const entry of value) url.searchParams.append(key, entry);
    else url.searchParams.set(key, String(value));
  }

  const response = await fetch(url, {
    method: options.method ?? 'GET',
    headers: {
      authorization: `Bearer ${apiKey}`,
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(options.idempotencyKey ? { 'idempotency-key': options.idempotencyKey } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    // Operational data: a cached dashboard is a misleading dashboard.
    cache: 'no-store',
  });

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  const payload: unknown = text ? safeParse(text) : null;

  if (!response.ok) {
    const problem = payload as { code?: string; detail?: string } | null;
    throw new ApiError(
      response.status,
      problem?.code ?? 'request_failed',
      problem?.detail ?? `The API answered ${response.status}.`,
      payload,
    );
  }

  return payload as T;
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { detail: text };
  }
}
