import Link from 'next/link';
import type { ReactNode } from 'react';

export type Segment = { value: string; label: ReactNode; href?: string; count?: ReactNode };
export function SegmentedControl({ label, items, value, onChange, className = '', dataAttribute, scroll }: {
  label: string; items: Segment[]; value: string; onChange?: (value: string) => void; className?: string; dataAttribute?: string; scroll?: boolean;
}) {
  return <div className={`segmented-control ${className}`} role="group" aria-label={label}>
    {items.map(item => {
      const content = <>{item.label}{item.count !== undefined ? <span className="segment-count">{item.count}</span> : null}</>;
      return item.href ? <Link key={item.value} href={item.href} scroll={scroll} aria-current={value === item.value ? 'page' : undefined}>{content}</Link>
        : <button key={item.value} type="button" {...(dataAttribute ? { [dataAttribute]: item.value } : {})} aria-pressed={value === item.value} onClick={() => onChange?.(item.value)}>{content}</button>;
    })}
  </div>;
}
