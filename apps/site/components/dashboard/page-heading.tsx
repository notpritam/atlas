'use client';
import Link from 'next/link';
import { useEntrance } from './motion';

export function PageHeading({ title, description }: { title: string; description: string }) {
  const ref = useEntrance<HTMLElement>(title, ':scope > *');
  return <header ref={ref} className="account-page-heading"><h1>{title}</h1><p>{description}</p></header>;
}
export function SettingsNav({ active }: { active: 'settings' | 'capture' | 'processing' }) {
  return <nav className="settings-nav" aria-label="Settings sections">{[
    { key: 'settings', href: '/dashboard/settings', label: 'Account' },
    { key: 'capture', href: '/dashboard/settings/capture', label: 'Browser capture' },
    { key: 'processing', href: '/dashboard/settings/processing', label: 'Processing' },
  ].map(link => <Link key={link.key} href={link.href} aria-current={active === link.key ? 'page' : undefined}>{link.label}</Link>)}</nav>;
}
