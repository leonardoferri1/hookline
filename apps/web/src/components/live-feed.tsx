'use client';

import { useEffect, useRef, useState } from 'react';
import type { StreamEvent } from '@/lib/types';
import { clockTime, duration } from '@/lib/format';

const MAX_ROWS = 120;

type Status = 'connecting' | 'live' | 'reconnecting';

/**
 * Live activity, fed by the proxied event stream.
 *
 * `EventSource` is used rather than a polling loop so the console shows a destination failing and
 * recovering as it happens, and so it reconnects on its own when the stream drops. Rows are capped
 * because a drill can emit hundreds of attempts in a minute and an unbounded list would be the
 * slowest thing on the page.
 */
export function LiveFeed({ title = 'Live activity', height }: { title?: string; height?: number }) {
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [status, setStatus] = useState<Status>('connecting');
  const source = useRef<EventSource | null>(null);

  useEffect(() => {
    const stream = new EventSource('/api/stream');
    source.current = stream;

    const push = (event: MessageEvent<string>): void => {
      try {
        const parsed = JSON.parse(event.data) as StreamEvent;
        if (parsed.kind === 'heartbeat') return;
        setEvents((current) => [parsed, ...current].slice(0, MAX_ROWS));
      } catch {
        // A frame we cannot read is not worth breaking the feed over.
      }
    };

    for (const kind of ['event.published', 'delivery.attempted', 'endpoint.circuit_changed'])
      stream.addEventListener(kind, push as EventListener);

    stream.addEventListener('open', () => setStatus('live'));
    stream.addEventListener('error', () => setStatus('reconnecting'));

    return () => {
      stream.close();
      source.current = null;
    };
  }, []);

  return (
    <section className="card">
      <header>
        <div>
          <h2>{title}</h2>
          <p>Published events, delivery attempts and breaker transitions, as they happen.</p>
        </div>
        <span className={`badge ${status === 'live' ? 'succeeded' : 'pending'}`}>{status}</span>
      </header>

      {events.length === 0 ? (
        <p className="empty">Nothing yet. Publish an event or start a drill.</p>
      ) : (
        <div className="feed" style={height ? { maxHeight: height } : undefined}>
          {events.map((event, index) => (
            <Row key={`${event.at}-${index}`} event={event} />
          ))}
        </div>
      )}
    </section>
  );
}

function Row({ event }: { event: StreamEvent }) {
  if (event.kind === 'heartbeat') return null;

  if (event.kind === 'event.published')
    return (
      <div className="feed-row">
        <time>{clockTime(event.at)}</time>
        <span className="what">
          published <strong>{event.eventType}</strong> → {event.deliveries} queued
        </span>
        <span className="badge plain">event</span>
      </div>
    );

  if (event.kind === 'endpoint.circuit_changed')
    return (
      <div className="feed-row is-circuit">
        <time>{clockTime(event.at)}</time>
        <span className="what">
          breaker <strong>{event.endpointName}</strong> {event.from} → {event.to}
          {event.retryAt ? ` · probe ${clockTime(event.retryAt)}` : ''}
        </span>
        <span className={`badge ${event.to}`}>{event.to}</span>
      </div>
    );

  const failed = event.outcome !== 'succeeded';
  return (
    <div className={`feed-row${failed ? ' is-error' : ''}`}>
      <time>{clockTime(event.at)}</time>
      <span className="what">
        {event.eventType} · attempt {event.attempt}/{event.maxAttempts} ·{' '}
        {event.statusCode ?? event.outcome} · {duration(event.durationMs)}
        {event.nextAttemptAt ? ` · retry ${clockTime(event.nextAttemptAt)}` : ''}
        {event.exhausted ? ' · budget spent' : ''}
      </span>
      <span className={`badge ${event.outcome}`}>
        {event.outcome === 'succeeded' ? 'delivered' : event.outcome}
      </span>
    </div>
  );
}
