'use client';
import { useEffect, useState } from 'react';

/** Web requests stay on this origin; never offer an account/environment switch. */
export function EnvironmentLabel({ compact = false }: { compact?: boolean }) {
  const [host, setHost] = useState<string | null>(null);
  useEffect(() => { setHost(window.location.host); }, []);
  if (!host) return null;
  const label = host === 'dev.foundkeep.app' ? 'DEV' : host === 'foundkeep.app' ? 'Production' : 'Local';
  if (compact && label !== 'DEV') return null;
  return <span className={`environment-identity${compact ? ' environment-compact' : ''}`} title={`Web app: ${host}`}><strong className="environment-badge">{label}</strong>{compact ? null : <span>{host}</span>}</span>;
}
