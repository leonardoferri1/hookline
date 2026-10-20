import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Hookline console',
  description: 'Webhook delivery: endpoints, signed deliveries, retries, replay and metrics.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
