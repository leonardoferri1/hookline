import Link from 'next/link';
import { AutoRefresh } from '@/components/auto-refresh';
import { FlashNotice } from '@/components/flash-notice';
import { LiveFeed } from '@/components/live-feed';
import { callApi } from '@/lib/api-client';
import { clockTime, duration, relative, stamp } from '@/lib/format';
import {
  DRILL_ENDPOINT_NAME,
  RECEIVER_SINK_URL,
  ReceiverUnavailableError,
  receiverState,
} from '@/lib/receiver-client';
import type { Delivery, Endpoint, ReceiverState } from '@/lib/types';
import { closeBreaker } from '../endpoints/actions';
import { clearReceiverLog, prepareDrill, publishBurst, updateBehaviour } from './actions';

export const dynamic = 'force-dynamic';

export default async function LabPage() {
  const endpoints = await callApi<Endpoint[]>('/endpoints');
  const drill = endpoints.find((endpoint) => endpoint.name === DRILL_ENDPOINT_NAME) ?? null;

  const [receiver, receiverError] = await loadReceiver();
  const deliveries = drill
    ? await callApi<Delivery[]>('/deliveries', { query: { endpointId: drill.id, limit: 12 } })
    : [];

  return (
    <>
      <AutoRefresh seconds={5} />

      <div className="page-head">
        <div>
          <h1>Failure drill</h1>
          <p>
            Break the destination on purpose and watch what the platform does with it. The bundled
            receiver can answer slowly, reject requests, or stop listening entirely - which is a
            different failure from an error response, and both should be visible in the history.
          </p>
        </div>
        {drill ? (
          <Link href={`/endpoints/${drill.id}`} className="button">
            Drill destination
          </Link>
        ) : null}
      </div>

      <div className="stack">
        <FlashNotice />

        {receiverError ? (
          <div className="notice error">
            <strong>The drill receiver is not reachable.</strong> {receiverError} Start the full
            local stack with <code>npm run dev</code>, which boots the API, the receiver and this
            console together.
          </div>
        ) : null}

        {!drill ? (
          <section className="card">
            <header>
              <div>
                <h2>Set up the drill</h2>
                <p>
                  Registers a destination pointing at <code>{RECEIVER_SINK_URL}</code>, issues its
                  signing secret and hands that secret to the receiver so it verifies every request.
                </p>
              </div>
            </header>
            <form action={prepareDrill}>
              <button type="submit" className="primary" disabled={Boolean(receiverError)}>
                Prepare the drill
              </button>
            </form>
          </section>
        ) : null}

        {drill ? (
          <div className="grid tiles">
            <div className="tile">
              <span>Destination</span>
              <strong style={{ fontSize: 16 }}>{drill.status}</strong>
              <small className="mono">{drill.url}</small>
            </div>
            <div
              className={`tile ${drill.health.circuitState === 'closed' ? 'good' : drill.health.circuitState === 'open' ? 'bad' : 'warn'}`}
            >
              <span>Circuit breaker</span>
              <strong style={{ fontSize: 20 }}>{drill.health.circuitState}</strong>
              <small>
                {drill.health.consecutiveFailures} consecutive failures
                {drill.health.circuitRetryAt
                  ? ` · probe ${relative(drill.health.circuitRetryAt)}`
                  : ''}
              </small>
            </div>
            <div className="tile">
              <span>Receiver</span>
              <strong style={{ fontSize: 16 }}>
                {receiver ? (receiver.listening ? 'listening' : 'offline') : 'unknown'}
              </strong>
              <small>
                {receiver
                  ? `${receiver.totalRequests} requests seen · ${receiver.secretsConfigured} secret(s) held`
                  : 'control plane unreachable'}
              </small>
            </div>
            <div className="tile">
              <span>Last success</span>
              <strong style={{ fontSize: 16 }}>{relative(drill.health.lastSuccessAt)}</strong>
              <small>{stamp(drill.health.lastSuccessAt)}</small>
            </div>
          </div>
        ) : null}

        <div className="grid halves">
          <section className="card">
            <header>
              <div>
                <h2>Receiver behaviour</h2>
                <p>Applies immediately, while deliveries are in flight.</p>
              </div>
            </header>

            <form action={updateBehaviour}>
              <div className="field">
                <label htmlFor="mode">Mode</label>
                <select id="mode" name="mode" defaultValue={receiver?.behaviour.mode ?? 'ok'}>
                  <option value="ok">ok · answer 2xx</option>
                  <option value="error">error · always reject</option>
                  <option value="offline">offline · stop listening, refuse connections</option>
                </select>
                <p className="hint">
                  Offline produces a refused connection rather than a status code, which is the
                  failure a genuinely dead host causes.
                </p>
              </div>

              <div className="field-row">
                <div className="field">
                  <label htmlFor="latencyMs">Added latency (ms)</label>
                  <input
                    id="latencyMs"
                    name="latencyMs"
                    type="number"
                    min={0}
                    max={30000}
                    step={100}
                    defaultValue={receiver?.behaviour.latencyMs ?? 0}
                  />
                  <p className="hint">Above 2000 the drill destination times out.</p>
                </div>
                <div className="field">
                  <label htmlFor="failureRate">Failure rate</label>
                  <input
                    id="failureRate"
                    name="failureRate"
                    type="number"
                    min={0}
                    max={1}
                    step={0.1}
                    defaultValue={receiver?.behaviour.failureRate ?? 0}
                  />
                  <p className="hint">Intermittent failures, applied in ok mode.</p>
                </div>
              </div>

              <div className="field-row">
                <div className="field">
                  <label htmlFor="statusCode">Failure status</label>
                  <select
                    id="statusCode"
                    name="statusCode"
                    defaultValue={String(receiver?.behaviour.statusCode ?? 503)}
                  >
                    <option value="500">500 internal error</option>
                    <option value="503">503 unavailable</option>
                    <option value="429">429 too many requests</option>
                    <option value="404">404 not found</option>
                    <option value="401">401 unauthorized</option>
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="retryAfterSeconds">Retry-After (s)</label>
                  <input
                    id="retryAfterSeconds"
                    name="retryAfterSeconds"
                    type="number"
                    min={0}
                    max={3600}
                    placeholder="not sent"
                    defaultValue={receiver?.behaviour.retryAfterSeconds ?? ''}
                  />
                  <p className="hint">When sent, the dispatcher honours it over its own backoff.</p>
                </div>
                <div className="field" style={{ alignSelf: 'end' }}>
                  <label className="checkbox" htmlFor="verifySignature">
                    <input
                      id="verifySignature"
                      name="verifySignature"
                      type="checkbox"
                      defaultChecked={receiver?.behaviour.verifySignature ?? true}
                    />
                    Verify signatures
                  </label>
                  <p className="hint">A failed check answers 401.</p>
                </div>
              </div>

              <div className="row" style={{ marginTop: 14 }}>
                <button type="submit" className="primary" disabled={Boolean(receiverError)}>
                  Apply behaviour
                </button>
              </div>
            </form>

            <hr style={{ border: 0, borderTop: '1px solid var(--line)', margin: '18px 0' }} />

            <div className="row">
              <form action={prepareDrill}>
                <button type="submit" disabled={Boolean(receiverError)}>
                  Re-sync signing secret
                </button>
              </form>
              <form action={clearReceiverLog}>
                <button type="submit" disabled={Boolean(receiverError)}>
                  Clear receiver log
                </button>
              </form>
              {drill && drill.health.circuitState !== 'closed' ? (
                <form action={closeBreaker}>
                  <input type="hidden" name="endpointId" value={drill.id} />
                  <input type="hidden" name="returnTo" value="/lab" />
                  <button type="submit">Close the breaker now</button>
                </form>
              ) : null}
            </div>
          </section>

          <section className="card">
            <header>
              <div>
                <h2>Publish a burst</h2>
                <p>
                  Events of type <code>drill.order-paid</code>, which only the drill destination
                  subscribes to.
                </p>
              </div>
            </header>

            <form action={publishBurst}>
              <div className="field-row">
                <div className="field">
                  <label htmlFor="count">Events</label>
                  <input id="count" name="count" type="number" min={1} max={50} defaultValue={8} />
                </div>
                <div className="field">
                  <label htmlFor="partitionKey">Partition key</label>
                  <input id="partitionKey" name="partitionKey" placeholder="leave empty" />
                  <p className="hint">
                    Shared key plus an ordered destination means one at a time, in order.
                  </p>
                </div>
              </div>
              <div className="row" style={{ marginTop: 14 }}>
                <button type="submit" className="primary" disabled={!drill}>
                  Publish
                </button>
                <span className="hint">
                  Each event carries its own idempotency key, so a double submit does not inflate
                  the drill.
                </span>
              </div>
            </form>

            <div className="notice" style={{ marginTop: 16 }}>
              <strong>Suggested drill.</strong> Publish eight events and watch them deliver. Switch
              the receiver to <em>offline</em> and publish eight more: attempts fail, the retry
              delay grows, and the breaker opens after five consecutive failures. Switch back to{' '}
              <em>ok</em>; one probe is allowed through, it succeeds, the breaker closes and the
              backlog drains. Anything that spent its retry budget is re-queued from the deliveries
              screen.
            </div>
          </section>
        </div>

        <LiveFeed title="Drill activity" height={300} />

        <div className="grid halves">
          <section className="card">
            <header>
              <div>
                <h2>Deliveries to the drill destination</h2>
                <p>The platform&rsquo;s own record.</p>
              </div>
            </header>
            {deliveries.length === 0 ? (
              <p className="empty">Nothing queued yet.</p>
            ) : (
              <div className="table-wrap" style={{ border: 0 }}>
                <table>
                  <thead>
                    <tr>
                      <th>State</th>
                      <th>Attempts</th>
                      <th>Last</th>
                      <th>Next / settled</th>
                    </tr>
                  </thead>
                  <tbody>
                    {deliveries.map((delivery) => (
                      <tr key={delivery.id}>
                        <td>
                          <Link href={`/deliveries/${delivery.id}`}>
                            <span className={`badge ${delivery.state}`}>{delivery.state}</span>
                          </Link>
                        </td>
                        <td className="num">
                          {delivery.attemptCount}/{delivery.maxAttempts}
                        </td>
                        <td className="num">
                          {delivery.lastStatusCode ??
                            delivery.lastError?.split('.')[0]?.slice(0, 28) ??
                            '—'}
                        </td>
                        <td className="num">
                          {delivery.state === 'pending'
                            ? relative(delivery.nextAttemptAt)
                            : duration(delivery.settledInMs)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="card">
            <header>
              <div>
                <h2>What the receiver saw</h2>
                <p>The destination&rsquo;s own view, including whether each signature verified.</p>
              </div>
            </header>
            {!receiver || receiver.requests.length === 0 ? (
              <p className="empty">No requests recorded.</p>
            ) : (
              <div className="table-wrap" style={{ border: 0 }}>
                <table>
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Received</th>
                      <th>Attempt</th>
                      <th>Signature</th>
                      <th>Answered</th>
                      <th>Held</th>
                    </tr>
                  </thead>
                  <tbody>
                    {receiver.requests.slice(0, 12).map((request) => (
                      <tr key={request.sequence}>
                        <td className="num">{request.sequence}</td>
                        <td className="num">{clockTime(request.receivedAt)}</td>
                        <td className="num">{request.attempt ?? '—'}</td>
                        <td>
                          <span className={`badge ${request.signature}`}>{request.signature}</span>
                          {request.signatureReason ? (
                            <div className="hint">{request.signatureReason}</div>
                          ) : null}
                        </td>
                        <td className="num">{request.statusReturned}</td>
                        <td className="num">{duration(request.handledInMs)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      </div>
    </>
  );
}

async function loadReceiver(): Promise<[ReceiverState | null, string | null]> {
  try {
    return [await receiverState(), null];
  } catch (error) {
    if (error instanceof ReceiverUnavailableError) return [null, error.message];
    throw error;
  }
}
