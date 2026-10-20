import { Delivery, DeliveryState } from '../domain/delivery';
import { AttemptOutcome, DeliveryAttempt, DeliveryListItem } from '../domain/delivery-attempt';

export interface DeliveryRow {
  id: string;
  tenant_id: string;
  event_id: string;
  endpoint_id: string;
  state: DeliveryState;
  attempt_count: number;
  max_attempts: number;
  partition_key: string | null;
  next_attempt_at: Date;
  leased_until: Date | null;
  leased_by: string | null;
  last_status_code: number | null;
  last_error: string | null;
  first_attempt_at: Date | null;
  completed_at: Date | null;
  replay_of: string | null;
  created_at: Date;
  updated_at: Date;
}

export const DELIVERY_COLUMNS = `id, tenant_id, event_id, endpoint_id, state, attempt_count,
  max_attempts, partition_key, next_attempt_at, leased_until, leased_by, last_status_code,
  last_error, first_attempt_at, completed_at, replay_of, created_at, updated_at`;

export function toDelivery(row: DeliveryRow): Delivery {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    eventId: row.event_id,
    endpointId: row.endpoint_id,
    state: row.state,
    attemptCount: row.attempt_count,
    maxAttempts: row.max_attempts,
    partitionKey: row.partition_key,
    nextAttemptAt: row.next_attempt_at,
    leasedUntil: row.leased_until,
    leasedBy: row.leased_by,
    lastStatusCode: row.last_status_code,
    lastError: row.last_error,
    firstAttemptAt: row.first_attempt_at,
    completedAt: row.completed_at,
    replayOf: row.replay_of,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface DeliveryListRow extends DeliveryRow {
  endpoint_name: string;
  event_type: string;
  settled_in_ms: number | null;
}

export interface DeliveryAttemptRow {
  id: string;
  delivery_id: string;
  attempt_number: number;
  outcome: AttemptOutcome;
  status_code: number | null;
  error_reason: string | null;
  error_message: string | null;
  duration_ms: number;
  request_headers: Record<string, string>;
  response_headers: Record<string, string>;
  response_body: string | null;
  response_truncated: boolean;
  started_at: Date;
}

export function toDeliveryListItem(row: DeliveryListRow): DeliveryListItem {
  return {
    id: row.id,
    state: row.state,
    endpointId: row.endpoint_id,
    endpointName: row.endpoint_name,
    eventId: row.event_id,
    eventType: row.event_type,
    partitionKey: row.partition_key,
    attemptCount: row.attempt_count,
    maxAttempts: row.max_attempts,
    lastStatusCode: row.last_status_code,
    lastError: row.last_error,
    nextAttemptAt: row.next_attempt_at,
    firstAttemptAt: row.first_attempt_at,
    completedAt: row.completed_at,
    replayOf: row.replay_of,
    createdAt: row.created_at,
    settledInMs: row.settled_in_ms === null ? null : Math.round(row.settled_in_ms),
  };
}

export function toDeliveryAttempt(row: DeliveryAttemptRow): DeliveryAttempt {
  return {
    id: row.id,
    deliveryId: row.delivery_id,
    attemptNumber: row.attempt_number,
    outcome: row.outcome,
    statusCode: row.status_code,
    errorReason: row.error_reason,
    errorMessage: row.error_message,
    durationMs: row.duration_ms,
    requestHeaders: row.request_headers,
    responseHeaders: row.response_headers,
    responseBody: row.response_body,
    responseTruncated: row.response_truncated,
    startedAt: row.started_at,
  };
}
