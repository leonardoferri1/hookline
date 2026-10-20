import Link from 'next/link';
import { AutoRefresh } from '@/components/auto-refresh';
import { LiveFeed } from '@/components/live-feed';
import { TimelineChart } from '@/components/timeline-chart';
import { WindowPicker } from '@/components/window-picker';
import { callApi } from '@/lib/api-client';
import { duration, percent, relative, stamp } from '@/lib/format';
import type { Metrics } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ window?: string }>;
}) {
  const { window } = await searchParams;
  const windowMinutes = Number(window) > 0 ? Number(window) : 60;
  const metrics = await callApi<Metrics>('/metrics', { query: { windowMinutes } });

  const { totals, latency, queue } = metrics;
  const openBreakers = metrics.endpoints.filter((endpoint) => endpoint.circuitState !== 'closed');

  return (
    <>
      <AutoRefresh seconds={10} />

      <div className="page-head">
        <div>
          <h1>Overview</h1>
          <p>
            Every number below is aggregated from the attempt log for the selected window, so it
            cannot disagree with the delivery history.
          </p>
        </div>
        <WindowPicker basePath="/overview" current={windowMinutes} />
      </div>

      <div className="stack">
        {openBreakers.length > 0 ? (
          <div className="notice error" role="status">
            <strong>
              {openBreakers.length} destination{openBreakers.length === 1 ? '' : 's'} not accepting
              deliveries.
            </strong>{' '}
            {openBreakers
              .map(
                (endpoint) =>
                  `${endpoint.name} (${endpoint.circuitState}, ${endpoint.consecutiveFailures} consecutive failures${
                    endpoint.circuitState === 'open' ? '' : ', probing'
                  })`,
              )
              .join(' · ')}
          </div>
        ) : null}

        <div className="grid tiles">
          <div className="tile">
            <span>Attempts</span>
            <strong>{totals.attempts}</strong>
            <small>
              {totals.succeeded} delivered · {totals.rejected} rejected · {totals.transportErrors}{' '}
              unreachable
            </small>
          </div>

          <div
            className={`tile ${totals.attempts === 0 ? '' : totals.errorRate > 0.1 ? 'bad' : totals.errorRate > 0 ? 'warn' : 'good'}`}
          >
            <span>Error rate</span>
            <strong>{totals.attempts === 0 ? '—' : percent(totals.errorRate)}</strong>
            <small>share of attempts that did not end in a 2xx</small>
          </div>

          <div className="tile">
            <span>Latency p95</span>
            <strong>{latency.p95Ms === null ? '—' : duration(latency.p95Ms)}</strong>
            <small>
              p50 {duration(latency.p50Ms)} · p99 {duration(latency.p99Ms)} · over{' '}
              {latency.answeredAttempts} answered
            </small>
          </div>

          <div className={`tile ${queue.failed > 0 ? 'warn' : ''}`}>
            <span>Queue</span>
            <strong>{queue.pending + queue.inFlight}</strong>
            <small>
              {queue.dueNow} due now · {queue.inFlight} in flight · {queue.failed} exhausted
            </small>
          </div>
        </div>

        <TimelineChart metrics={metrics} />

        <div className="grid halves">
          <section className="card">
            <header>
              <div>
                <h2>Destinations</h2>
                <p>
                  An endpoint with no traffic in the window still appears, because going silent is
                  worth noticing.
                </p>
              </div>
              <Link href="/endpoints" className="button">
                Manage
              </Link>
            </header>

            {metrics.endpoints.length === 0 ? (
              <p className="empty">
                No endpoints yet. <Link href="/endpoints">Register one</Link> to start delivering.
              </p>
            ) : (
              <div className="table-wrap" style={{ border: 0 }}>
                <table>
                  <thead>
                    <tr>
                      <th>Endpoint</th>
                      <th>Breaker</th>
                      <th>Attempts</th>
                      <th>Errors</th>
                      <th>p95</th>
                      <th>Last success</th>
                    </tr>
                  </thead>
                  <tbody>
                    {metrics.endpoints.map((endpoint) => (
                      <tr key={endpoint.endpointId}>
                        <td>
                          <Link href={`/endpoints/${endpoint.endpointId}`}>{endpoint.name}</Link>
                          {endpoint.status === 'paused' ? (
                            <>
                              {' '}
                              <span className="badge paused">paused</span>
                            </>
                          ) : null}
                        </td>
                        <td>
                          <span className={`badge ${endpoint.circuitState}`}>
                            {endpoint.circuitState}
                          </span>
                        </td>
                        <td className="num">{endpoint.totals.attempts}</td>
                        <td className="num">
                          {endpoint.totals.attempts === 0
                            ? '—'
                            : percent(endpoint.totals.errorRate, 0)}
                        </td>
                        <td className="num">{duration(endpoint.p95Ms)}</td>
                        <td className="num">{relative(endpoint.lastSuccessAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <LiveFeed height={340} />
        </div>

        <p className="hint">
          Window {stamp(metrics.window.from)} → {stamp(metrics.window.to)}. Latency percentiles
          cover attempts a destination answered; timeouts and refused connections are counted as
          errors instead, so the figure describes destination speed rather than how long Hookline
          waited.
        </p>
      </div>
    </>
  );
}
