import type { Metrics } from '@/lib/types';
import { clockTime } from '@/lib/format';

/**
 * Attempts per bucket, split into delivered and failed.
 *
 * Deliberately a plain stacked bar chart rendered with divs: the shape of an outage - a wall of
 * red, then green returning - is the whole message, and it does not need a charting library or a
 * client bundle to be legible.
 */
export function TimelineChart({ metrics }: { metrics: Metrics }) {
  const peak = Math.max(1, ...metrics.timeline.map((bucket) => bucket.attempts));

  return (
    <section className="card">
      <header>
        <div>
          <h2>Delivery attempts</h2>
          <p>
            {metrics.timeline.length} buckets of {metrics.window.bucketSeconds}s · peak {peak}{' '}
            attempts
          </p>
        </div>
      </header>

      <div className="chart" role="img" aria-label="Delivery attempts over time">
        {metrics.timeline.map((bucket) => {
          const idle = bucket.attempts === 0;
          return (
            <div
              key={bucket.bucketStart}
              className={`bar${idle ? ' idle' : ''}`}
              title={`${clockTime(bucket.bucketStart)} · ${bucket.succeeded} delivered · ${bucket.failed} failed`}
            >
              {idle ? (
                <i />
              ) : (
                <>
                  {bucket.failed > 0 ? (
                    <i className="bad" style={{ height: `${(bucket.failed / peak) * 100}%` }} />
                  ) : null}
                  {bucket.succeeded > 0 ? (
                    <i className="ok" style={{ height: `${(bucket.succeeded / peak) * 100}%` }} />
                  ) : null}
                </>
              )}
            </div>
          );
        })}
      </div>

      <div className="chart-legend">
        <span>
          <i style={{ background: 'var(--accent-dim)' }} /> delivered
        </span>
        <span>
          <i style={{ background: 'var(--danger)' }} /> failed
        </span>
        <span>
          {clockTime(metrics.window.from)} → {clockTime(metrics.window.to)}
        </span>
      </div>
    </section>
  );
}
