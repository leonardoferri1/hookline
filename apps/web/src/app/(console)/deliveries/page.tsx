import Link from 'next/link';
import { FlashNotice } from '@/components/flash-notice';
import { callApi } from '@/lib/api-client';
import { duration, relative, stamp } from '@/lib/format';
import type { Delivery, DeliveryState, Endpoint } from '@/lib/types';
import { replayEndpointBacklog } from './actions';

export const dynamic = 'force-dynamic';

const STATES: DeliveryState[] = ['pending', 'in_flight', 'succeeded', 'failed', 'canceled'];
const PAGE_SIZE = 50;

export default async function DeliveriesPage({
  searchParams,
}: {
  searchParams: Promise<{
    endpointId?: string;
    state?: string;
    eventType?: string;
    before?: string;
  }>;
}) {
  const filters = await searchParams;
  const selectedStates = filters.state ? filters.state.split(',').filter(Boolean) : [];

  const [deliveries, endpoints] = await Promise.all([
    callApi<Delivery[]>('/deliveries', {
      query: {
        endpointId: filters.endpointId,
        state: selectedStates.length > 0 ? selectedStates : undefined,
        eventType: filters.eventType,
        before: filters.before,
        limit: PAGE_SIZE,
      },
    }),
    callApi<Endpoint[]>('/endpoints'),
  ]);

  const last = deliveries.at(-1);
  const nextPage =
    deliveries.length === PAGE_SIZE && last ? buildQuery(filters, last.createdAt) : null;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Deliveries</h1>
          <p>
            One row per event and destination. A replay appears as its own delivery pointing at the
            original, so the record of what already happened stays intact.
          </p>
        </div>
      </div>

      <div className="stack">
        <FlashNotice />

        <form className="toolbar" method="get">
          <div className="field">
            <label htmlFor="endpointId">Destination</label>
            <select id="endpointId" name="endpointId" defaultValue={filters.endpointId ?? ''}>
              <option value="">All destinations</option>
              {endpoints.map((endpoint) => (
                <option key={endpoint.id} value={endpoint.id}>
                  {endpoint.name}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="state">State</label>
            <select id="state" name="state" defaultValue={filters.state ?? ''}>
              <option value="">Any state</option>
              {STATES.map((state) => (
                <option key={state} value={state}>
                  {state}
                </option>
              ))}
              <option value="failed,canceled">failed or canceled</option>
              <option value="pending,in_flight">still working</option>
            </select>
          </div>

          <div className="field">
            <label htmlFor="eventType">Event type</label>
            <input
              id="eventType"
              name="eventType"
              placeholder="order.paid"
              defaultValue={filters.eventType ?? ''}
            />
          </div>

          <button type="submit">Apply</button>
          <Link href="/deliveries" className="button">
            Clear
          </Link>
        </form>

        {/* Kept out of the filter form: a form cannot be nested inside another form. */}
        {filters.endpointId ? (
          <form action={replayEndpointBacklog} className="row">
            <input type="hidden" name="endpointId" value={filters.endpointId} />
            <button type="submit">Replay this destination&rsquo;s exhausted backlog</button>
            <span className="hint">
              Re-queues every delivery that spent its retry budget, oldest first.
            </span>
          </form>
        ) : null}

        <div className="table-wrap">
          {deliveries.length === 0 ? (
            <p className="empty">No deliveries match these filters.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Event</th>
                  <th>Destination</th>
                  <th>State</th>
                  <th>Attempts</th>
                  <th>Last result</th>
                  <th>Next / settled</th>
                  <th>Queued</th>
                </tr>
              </thead>
              <tbody>
                {deliveries.map((delivery) => (
                  <tr key={delivery.id}>
                    <td>
                      <Link href={`/deliveries/${delivery.id}`}>
                        <strong>{delivery.eventType}</strong>
                      </Link>
                      {delivery.replayOf ? (
                        <>
                          {' '}
                          <span className="badge plain">replay</span>
                        </>
                      ) : null}
                      {delivery.partitionKey ? (
                        <div className="hint">key {delivery.partitionKey}</div>
                      ) : null}
                    </td>
                    <td>
                      <Link href={`/endpoints/${delivery.endpointId}`}>
                        {delivery.endpointName}
                      </Link>
                    </td>
                    <td>
                      <span className={`badge ${delivery.state}`}>{delivery.state}</span>
                    </td>
                    <td className="num">
                      {delivery.attemptCount}/{delivery.maxAttempts}
                    </td>
                    <td className="num">
                      {delivery.lastStatusCode ?? '—'}
                      {delivery.lastError ? (
                        <div className="hint" style={{ fontFamily: 'var(--mono)' }}>
                          {delivery.lastError.slice(0, 48)}
                        </div>
                      ) : null}
                    </td>
                    <td className="num">
                      {delivery.state === 'pending'
                        ? relative(delivery.nextAttemptAt)
                        : duration(delivery.settledInMs)}
                    </td>
                    <td className="num" title={stamp(delivery.createdAt)}>
                      {stamp(delivery.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="row">
          {nextPage ? (
            <Link href={`/deliveries?${nextPage}`} className="button">
              Older deliveries
            </Link>
          ) : (
            <span className="hint">End of the matching history.</span>
          )}
          {filters.before ? (
            <Link href={`/deliveries?${buildQuery(filters, undefined)}`} className="button">
              Back to newest
            </Link>
          ) : null}
        </div>
      </div>
    </>
  );
}

/** Keyset pagination: the cursor is the last row's timestamp, carried in the URL. */
function buildQuery(
  filters: { endpointId?: string; state?: string; eventType?: string },
  before: string | undefined,
): string {
  const query = new URLSearchParams();
  if (filters.endpointId) query.set('endpointId', filters.endpointId);
  if (filters.state) query.set('state', filters.state);
  if (filters.eventType) query.set('eventType', filters.eventType);
  if (before) query.set('before', before);
  return query.toString();
}
