import Link from 'next/link';
import { FlashNotice } from '@/components/flash-notice';
import { callApi } from '@/lib/api-client';
import { relative, stamp } from '@/lib/format';
import type { CurrentPrincipal, Endpoint } from '@/lib/types';
import { createEndpoint } from './actions';

export const dynamic = 'force-dynamic';

export default async function EndpointsPage() {
  const [endpoints, principal] = await Promise.all([
    callApi<Endpoint[]>('/endpoints'),
    callApi<CurrentPrincipal>('/me'),
  ]);
  const atLimit = endpoints.length >= principal.limits.maxEndpoints;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Endpoints</h1>
          <p>
            A destination carries its own subscriptions, retry budget and timeout. Deliveries
            already queued keep the budget they were given, so changing one here never rewrites the
            past.
          </p>
        </div>
        <span className="badge plain">
          {endpoints.length} / {principal.limits.maxEndpoints} used
        </span>
      </div>

      <div className="stack">
        <FlashNotice />

        <div className="table-wrap">
          {endpoints.length === 0 ? (
            <p className="empty">No destinations yet. Register the first one below.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Destination</th>
                  <th>Subscriptions</th>
                  <th>State</th>
                  <th>Breaker</th>
                  <th>Budget</th>
                  <th>Last success</th>
                </tr>
              </thead>
              <tbody>
                {endpoints.map((endpoint) => (
                  <tr key={endpoint.id}>
                    <td>
                      <Link href={`/endpoints/${endpoint.id}`}>
                        <strong>{endpoint.name}</strong>
                      </Link>
                      {endpoint.ordered ? (
                        <>
                          {' '}
                          <span className="badge plain">ordered</span>
                        </>
                      ) : null}
                      {endpoint.description ? (
                        <div className="hint">{endpoint.description}</div>
                      ) : null}
                    </td>
                    <td className="num">{endpoint.url}</td>
                    <td className="num">{endpoint.eventTypes.join(' ')}</td>
                    <td>
                      <span className={`badge ${endpoint.status}`}>{endpoint.status}</span>
                    </td>
                    <td>
                      <span className={`badge ${endpoint.health.circuitState}`}>
                        {endpoint.health.circuitState}
                      </span>
                      {endpoint.health.consecutiveFailures > 0 ? (
                        <div className="hint">
                          {endpoint.health.consecutiveFailures} consecutive failures
                        </div>
                      ) : null}
                    </td>
                    <td className="num">
                      {endpoint.maxAttempts} tries · {endpoint.timeoutMs}ms
                    </td>
                    <td className="num" title={stamp(endpoint.health.lastSuccessAt)}>
                      {relative(endpoint.health.lastSuccessAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <section className="card">
          <header>
            <div>
              <h2>Register a destination</h2>
              <p>
                Subscriptions accept an exact event type, a prefix ending in <code>.*</code>, or{' '}
                <code>*</code> for everything. Separate several with spaces or commas.
              </p>
            </div>
          </header>

          {atLimit ? (
            <div className="notice">
              This tenant has reached its endpoint limit of {principal.limits.maxEndpoints}. Remove
              one before adding another.
            </div>
          ) : (
            <form action={createEndpoint}>
              <div className="field-row">
                <div className="field">
                  <label htmlFor="name">Name</label>
                  <input
                    id="name"
                    name="name"
                    required
                    maxLength={80}
                    placeholder="Billing service"
                  />
                </div>
                <div className="field">
                  <label htmlFor="url">Destination URL</label>
                  <input
                    id="url"
                    name="url"
                    required
                    placeholder="http://127.0.0.1:3022/hooks/billing"
                  />
                </div>
              </div>

              <div className="field">
                <label htmlFor="eventTypes">Subscriptions</label>
                <input
                  id="eventTypes"
                  name="eventTypes"
                  required
                  placeholder="order.* invoice.paid"
                  defaultValue="*"
                />
              </div>

              <div className="field">
                <label htmlFor="description">Description</label>
                <input
                  id="description"
                  name="description"
                  maxLength={280}
                  placeholder="What this destination does with the events."
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
                    defaultValue={6}
                  />
                  <p className="hint">Attempts before a delivery is given up on.</p>
                </div>
                <div className="field">
                  <label htmlFor="timeoutMs">Request timeout (ms)</label>
                  <input
                    id="timeoutMs"
                    name="timeoutMs"
                    type="number"
                    min={500}
                    max={30000}
                    step={100}
                    defaultValue={10000}
                  />
                </div>
                <div className="field" style={{ alignSelf: 'end' }}>
                  <label className="checkbox" htmlFor="ordered">
                    <input id="ordered" name="ordered" type="checkbox" />
                    Deliver one partition key at a time
                  </label>
                  <p className="hint">Ordered delivery trades throughput for sequence.</p>
                </div>
              </div>

              <div className="row" style={{ marginTop: 16 }}>
                <button type="submit" className="primary">
                  Register and issue secret
                </button>
                <span className="hint">The signing secret is shown once, immediately after.</span>
              </div>
            </form>
          )}
        </section>
      </div>
    </>
  );
}
