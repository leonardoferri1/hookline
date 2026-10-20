'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * A client component only because the current route decides the active state. Everything else in
 * the shell stays on the server.
 */
export function NavLink({
  href,
  label,
  shortcut,
}: {
  href: string;
  label: string;
  shortcut?: string;
}) {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link href={href} aria-current={active ? 'page' : undefined}>
      {label}
      {shortcut ? <small>{shortcut}</small> : null}
    </Link>
  );
}
