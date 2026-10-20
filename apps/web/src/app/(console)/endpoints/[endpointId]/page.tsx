import Link from 'next/link';
import { notFound } from 'next/navigation';
import { FlashNotice } from '@/components/flash-notice';
import { ApiError, callApi } from '@/lib/api-client';
import { duration, percent, relative, stamp } from '@/lib/format';
import type { Delivery, Endpoint, EndpointSecret, Metrics } from '@/lib/types';
import {
  closeBreaker,
  deleteEndpoint,
  rotateSecret,
  setEndpointStatus,
  updateEndpoint,
} from '../actions';

export const dynamic = 'force-dynamic';

export default async function EndpointPage({
  params,
}: {
  params: Promise<{ endpointId: string }>;
}) {
  const { endpointId } = await params;

  let endpoint: Endpoint;
  try {
    endpoint = await callApi<Endpoint>(`/endpoints/${endpointId}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }

  const [secrets, metrics, deliveries] = await Promise.all([
    callApi<EndpointSecret[]>(`/endpoints/${endpointId}/secrets`),
    callApi<Metrics>('/metrics', { query: { windowMinutes: 1440, endpointId } }),
    callApi<Delivery[]>('/deliveries', { query: { endpointId, limit: 8 } }),
  ]);

  const health = endpoint.health;
  const summary = metrics.endpoints[0];

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{endpoint.name}</h1>
          <p className="mono">{endpoint.url}</p>
        </div>
        <div className="row">
          <span className={`badge ${endpoint.status}`}>{endpoint.status}</span>
          <span className={`badge ${health.circuitState}`}>breaker {health.circuitState}</span>
          <Link href="/endpoints" className="button">
            All endpoints
          </Link>
        </div>
      </div>

      <div className="stack">
        <FlashNotice />

        {health.circuitState !== 'closed' ? (
          <div className="notice error">
            <strong>This destination is not receiving deliveries.</strong>{' '}
            {health.consecutiveFailures} consecutive failures, down since{' '}
            {stamp(health.circuitOpenedAt)}
            {health.circuitRetryAt ? `, next probe ${relative(health.circuitRetryAt)}` : ''}. Queued
            deliveries wait; nothing is lost. A single successful probe closes the breaker and
            releases the backlog.
            <form action={closeBreaker} style={{ marginTop: 10 }}>
              <input type="hidden" name="endpointId" value={endpoint.id} />
              <button type="submit">Close the breaker now</button>
            </form>
          </div>
        ) : null}

        <div className="grid tiles">
          <div className="tile">
            <span>Attempts · 24h</span>
            <strong>{summary?.totals.attempts ?? 0}</strong>
            <small>
              {summary?.totals.succeeded ?? 0} delivered · {summary?.totals.rejected ?? 0} rejected
              · {summary?.totals.transportErrors ?? 0} unreachable
            </small>
          </div>
          <div className="tile">
            <span>Error rate · 24h</span>
            <strong>
              {!summary || summary.totals.attempts === 0 ? '—' : percent(summary.totals.errorRate)}
            </strong>
            <small>p95 {duration(summary?.p95Ms ?? null)}</small>
          </div>
          <div className="tile">
            <span>Last success</span>
            <strong style={{ fontSize: 18 }}>{relative(health.lastSuccessAt)}</strong>
            <small>{stamp(health.lastSuccessAt)}</small>
          </div>
          <div className="tile">
            <span>Last failure</span>
            <strong style={{ fontSize: 18 }}>{relative(health.lastFailureAt)}</strong>
            <small>{stamp(health.lastFailureAt)}</small>
          </div>
        </div>

        <div className="grid halves">
          <section className="card">
            <header>
              <div>
                <h2>Configuration</h2>
                <p>Changes apply to deliveries queued from now on.</p>
              </div>
            </header>

            <form action={updateEndpoint}>
              <input type="hidden" name="endpointId" value={endpoint.id} />
              <div className="field">
                <label htmlFor="name">Name</label>
                <input id="name" name="name" defaultValue={endpoint.name} maxLength={80} required />
              </div>
              <div className="field">
                <label htmlFor="url">Destination URL</label>
                <input id="url" name="url" defaultValue={endpoint.url} required />
              </div>
              <div className="field">
                <label htmlFor="eventTypes">Subscriptions</label>
                <input
                  id="eventTypes"
                  name="eventTypes"
                  defaultValue={endpoint.eventTypes.join(' ')}
                  required
                />
              </div>
              <div className="field-row">
                <div className="field">
                  <label htmlFor="maxAttempts">Retry budget</label>
                  <input
                    id="maxAttempts"
                    name="maxAttempts"
                    type="number"
                    min={1}
                    max={20}
                    defaultValue={endpoint.maxAttempts}
                  />
                </div>
                <div className="field">
                  <label htmlFor="timeoutMs">Timeout (ms)</label>
                  <input
                    id="timeoutMs"
                    name="timeoutMs"
                    type="number"
                    min={500}
                    max={30000}
                    step={100}
                    defaultValue={endpoint.timeoutMs}
                  />
                </div>
                <div className="field" style={{ alignSelf: 'end' }}>
                  <label className="checkbox" htmlFor="ordered">
                    <input
                      id="ordered"
                      name="ordered"
                      type="checkbox"
                      defaultChecked={endpoint.ordered}
                    />
                    Ordered per partition key
                  </label>
                </div>
              </div>
              <div className="row" style={{ marginTop: 14 }}>
                <button type="submit" className="primary">
                  Save
                </button>
              </div>
            </form>

            <hr style={{ border: 0, borderTop: '1px solid var(--line)', margin: '18px 0' }} />

            <div className="row">
              <form action={setEndpointStatus}>
                <input type="hidden" name="endpointId" value={endpoint.id} />
                <input
                  type="hidden"
                  name="status"
                  value={endpoint.status === 'enabled' ? 'paused' : 'enabled'}
                />
                <button type="submit">
                  {endpoint.status === 'enabled' ? 'Pause deliveries' : 'Enable and close breaker'}
                </button>
              </form>

              <form action={deleteEndpoint}>
                <input type="hidden" name="endpointId" value={endpoint.id} />
                <button type="submit" className="danger">
                  Delete endpoint
                </button>
              </form>
            </div>
            <p className="hint">
              Pausing keeps the queue intact and sends nothing. Enabling also closes an open
              breaker: turning a destination back on asserts it is healthy, and the next failure
              opens it again.
            </p>
          </section>

          <section className="card">
            <header>
              <div>
                <h2>Signing secrets</h2>
                <p>
                  Requests are signed with every active secret, so a consumer can adopt a new one
                  before the old one stops.
                </p>
              </div>
            </header>

            <div className="table-wrap" style={{ border: 0 }}>
              <table>
                <thead>
                  <tr>
                    <th>Secret</th>
                    <th>Issued</th>
                    <th>Signs until</th>
                    <th>State</th>
                  </tr>
                </thead>
                <tbody>
                  {secrets.map((secret) => (
                    <tr key={secret.id}>
                      <td className="num">{secret.hint}</td>
                      <td className="num">{stamp(secret.createdAt)}</td>
                      <td className="num">
                        {secret.expiresAt ? stamp(secret.expiresAt) : 'no end set'}
                      </td>
                      <td>
                        <span className={`badge ${secret.active ? 'succeeded' : 'failed'}`}>
                          {secret.active ? 'active' : 'retired'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <form action={rotateSecret} style={{ marginTop: 16 }}>
              <input type="hidden" name="endpointId" value={endpoint.id} />
              <div className="field">
                <label htmlFor="graceSeconds">Overlap window</label>
                <select id="graceSeconds" name="graceSeconds" defaultValue="86400">
                  <option value="0">End the previous secret immediately</option>
                  <option value="300">5 minutes</option>
                  <option value="3600">1 hour</option>
                  <option value="86400">24 hours</option>
                  <option value="604800">7 days</option>
                </select>
              </div>
              <div className="row" style={{ marginTop: 12 }}>
                <button type="submit">Rotate secret</button>
                <span className="hint">Only the last four characters of a secret are listed.</span>
              </div>
            </form>
          </section>
        </div>

        <section className="card">
          <header>
            <div>
              <h2>Recent deliveries</h2>
              <p>The last eight attempts queued for this destination.</p>
            </div>
            <Link href={`/deliveries?endpointId=${endpoint.id}`} className="button">
              Full history
            </Link>
          </header>

          {deliveries.length === 0 ? (
            <p className="empty">Nothing delivered here yet.</p>
          ) : (
            <div className="table-wrap" style={{ border: 0 }}>
              <table>
                <thead>
                  <tr>
                    <th>Event</th>
                    <th>State</th>
                    <th>Attempts</th>
                    <th>Last status</th>
                    <th>Queued</th>
                  </tr>
                </thead>
                <tbody>
                  {deliveries.map((delivery) => (
                    <tr key={delivery.id}>
                      <td>
                        <Link href={`/deliveries/${delivery.id}`}>{delivery.eventType}</Link>
                      </td>
                      <td>
                        <span className={`badge ${delivery.state}`}>{delivery.state}</span>
                      </td>
                      <td className="num">
                        {delivery.attemptCount}/{delivery.maxAttempts}
                      </td>
                      <td className="num">
                        {delivery.lastStatusCode ?? delivery.lastError?.slice(0, 40) ?? '—'}
                      </td>
                      <td className="num">{stamp(delivery.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
