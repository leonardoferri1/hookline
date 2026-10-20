import Link from 'next/link';

const WINDOWS = [
  { minutes: 15, label: '15m' },
  { minutes: 60, label: '1h' },
  { minutes: 360, label: '6h' },
  { minutes: 1440, label: '24h' },
];

/** Plain links rather than a client-side control: the window belongs in the URL. */
export function WindowPicker({ basePath, current }: { basePath: string; current: number }) {
  return (
    <div className="row" role="group" aria-label="Metrics window">
      {WINDOWS.map((option) => (
        <Link
          key={option.minutes}
          href={`${basePath}?window=${option.minutes}`}
          className="button"
          aria-current={option.minutes === current ? 'true' : undefined}
          style={
            option.minutes === current
              ? { background: '#ffffff22', borderColor: 'var(--line-strong)' }
              : undefined
          }
        >
          {option.label}
        </Link>
      ))}
    </div>
  );
}
