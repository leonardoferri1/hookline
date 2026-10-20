import Link from 'next/link';
import { notFound } from 'next/navigation';
import { FlashNotice } from '@/components/flash-notice';
import { ApiError, callApi } from '@/lib/api-client';
import { duration, relative, stamp } from '@/lib/format';
import type { DeliveryAttempt, DeliveryDetail, PublishedEvent } from '@/lib/types';
import { cancelDelivery, replayDelivery } from '../actions';

export const dynamic = 'force-dynamic';

export default async function DeliveryPage({
  params,
}: {
  params: Promise<{ deliveryId: string }>;
}) {
  const { deliveryId } = await params;

  let detail: DeliveryDetail;
  try {
    detail = await callApi<DeliveryDetail>(`/deliveries/${deliveryId}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }

  const { delivery, attempts } = detail;
  const event = await callApi<PublishedEvent>(`/events/${delivery.eventId}`);
  const settled = delivery.state !== 'pending' && delivery.state !== 'in_flight';

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{delivery.eventType}</h1>
          <p>
            to <Link href={`/endpoints/${delivery.endpointId}`}>{delivery.endpointName}</Link> ·
            queued {stamp(delivery.createdAt)}
          </p>
        </div>
        <div className="row">
          <span className={`badge ${delivery.state}`}>{delivery.state}</span>
          <Link href="/deliveries" className="button">
            All deliveries
          </Link>
        </div>
      </div>

      <div className="stack">
        <FlashNotice />

        {delivery.replayOf ? (
          <div className="notice">
            This delivery is a replay of{' '}
            <Link href={`/deliveries/${delivery.replayOf}`} className="mono">
              {delivery.replayOf}
            </Link>
            . The original keeps its own attempts.
          </div>
        ) : null}

        <div className="grid tiles">
          <div className="tile">
            <span>Attempts</span>
            <strong>
              {delivery.attemptCount}/{delivery.maxAttempts}
            </strong>
            <small>
              {settled
                ? `settled in ${duration(delivery.settledInMs)}`
                : `next attempt ${relative(delivery.nextAttemptAt)}`}
            </small>
          </div>
          <div className="tile">
            <span>Last result</span>
            <strong style={{ fontSize: 20 }}>{delivery.lastStatusCode ?? '—'}</strong>
            <small>{delivery.lastError ?? 'no error recorded'}</small>
          </div>
          <div className="tile">
            <span>Event</span>
            <strong style={{ fontSize: 15 }} className="mono">
              {delivery.eventId.slice(0, 8)}
            </strong>
            <small>
              occurred {stamp(event.event.occurredAt)}
              {event.event.source ? ` · from ${event.event.source}` : ''}
            </small>
          </div>
          <div className="tile">
            <span>Partition key</span>
            <strong style={{ fontSize: 15 }} className="mono">
              {delivery.partitionKey ?? 'none'}
            </strong>
            <small>
              {delivery.partitionKey
                ? 'ordered destinations send this key one at a time'
                : 'no ordering constraint'}
            </small>
          </div>
        </div>

        <div className="row">
          <form action={replayDelivery}>
            <input type="hidden" name="deliveryId" value={delivery.id} />
            <button type="submit" className="primary" disabled={!settled}>
              Replay this delivery
            </button>
          </form>
          <form action={cancelDelivery}>
            <input type="hidden" name="deliveryId" value={delivery.id} />
            <button type="submit" disabled={delivery.state !== 'pending'}>
              Cancel
            </button>
          </form>
          <span className="hint">
            {settled
              ? 'A replay is queued as a new delivery; this record is not modified.'
              : 'Replay becomes available once this delivery settles, and cancelling only applies before it is claimed.'}
          </span>
        </div>

        <section className="card">
          <header>
            <div>
              <h2>Attempts</h2>
              <p>
                Each attempt records the signature header as sent and the response as received,
                truncated to the stored cap. The signing secret itself is never stored.
              </p>
            </div>
          </header>

          {attempts.length === 0 ? (
            <p className="empty">Not attempted yet.</p>
          ) : (
            attempts.map((attempt) => (
              <AttemptBlock key={attempt.attemptNumber} attempt={attempt} />
            ))
          )}
        </section>

        <section className="card">
          <header>
            <div>
              <h2>Event payload</h2>
              <p>
                The body is byte-identical on every attempt and every replay, so a consumer can
                compare or cache it. Deduplicate on <code>Hookline-Event-Id</code>.
              </p>
            </div>
          </header>
          <pre
            style={{
              background: 'var(--ink-sunken)',
              border: '1px solid var(--line)',
              borderRadius: 6,
              padding: 12,
              maxHeight: 320,
            }}
          >
            {JSON.stringify(event.event.payload, null, 2)}
          </pre>
          <dl className="kv" style={{ marginTop: 14 }}>
            <dt>Event id</dt>
            <dd>{event.event.id}</dd>
            <dt>Idempotency key</dt>
            <dd>{event.event.idempotencyKey ?? 'none supplied'}</dd>
            <dt>Fanned out to</dt>
            <dd>{event.deliveries.length} destination(s)</dd>
          </dl>
        </section>
      </div>
    </>
  );
}

function AttemptBlock({ attempt }: { attempt: DeliveryAttempt }) {
  const label =
    attempt.outcome === 'succeeded'
      ? `delivered ${attempt.statusCode}`
      : attempt.outcome === 'rejected'
        ? `rejected ${attempt.statusCode}`
        : (attempt.errorReason ?? 'unreachable');

  return (
    <details className="attempt" open={attempt.outcome !== 'succeeded'}>
      <summary>
        <strong>#{attempt.attemptNumber}</strong>
        <span className={`badge ${attempt.outcome}`}>{label}</span>
        <span className="mono" style={{ color: 'var(--text-faint)' }}>
          {stamp(attempt.startedAt)} · {duration(attempt.durationMs)}
        </span>
      </summary>
      <div>
        {attempt.errorMessage ? <div className="notice error">{attempt.errorMessage}</div> : null}

        <div className="grid halves">
          <div>
            <h3 style={{ marginBottom: 6, color: 'var(--text-faint)' }}>Request headers sent</h3>
            <pre>{formatHeaders(attempt.requestHeaders)}</pre>
          </div>
          <div>
            <h3 style={{ marginBottom: 6, color: 'var(--text-faint)' }}>Response headers</h3>
            <pre>
              {Object.keys(attempt.responseHeaders).length === 0
                ? 'no response'
                : formatHeaders(attempt.responseHeaders)}
            </pre>
          </div>
        </div>

        <div>
          <h3 style={{ marginBottom: 6, color: 'var(--text-faint)' }}>
            Response body{attempt.responseTruncated ? ' (truncated)' : ''}
          </h3>
          <pre>{attempt.responseBody?.trim() || 'empty'}</pre>
        </div>
      </div>
    </details>
  );
}

function formatHeaders(headers: Record<string, string>): string {
  return Object.entries(headers)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => `${name}: ${value}`)
    .join('\n');
}
