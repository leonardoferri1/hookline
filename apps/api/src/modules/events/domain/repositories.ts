import { Queryable } from '../../../shared/database/database.service';
import { HooklineEvent } from './event';

export interface RecordEventInput {
  readonly tenantId: string;
  readonly type: string;
  readonly payload: unknown;
  readonly partitionKey: string | null;
  readonly idempotencyKey: string | null;
  readonly payloadFingerprint: string;
  readonly source: string | null;
  readonly occurredAt: Date;
}

export interface EventQuery {
  readonly tenantId: string;
  readonly type?: string;
  readonly limit: number;
  /** Keyset cursor: only events created strictly before this moment are returned. */
  readonly before?: Date;
}

export abstract class EventRepository {
  abstract record(input: RecordEventInput, client?: Queryable): Promise<HooklineEvent>;
  abstract findById(
    tenantId: string,
    id: string,
    client?: Queryable,
  ): Promise<HooklineEvent | null>;
  abstract findByIdempotencyKey(
    tenantId: string,
    idempotencyKey: string,
    client?: Queryable,
  ): Promise<HooklineEvent | null>;
  abstract list(query: EventQuery, client?: Queryable): Promise<HooklineEvent[]>;
}
