import type { ComponentPropsWithoutRef } from 'react';
import './plan-card.css';

/** One pricing surface for the public comparison and the signed-in plan page. */
export function PlanCard({ featured = false, className = '', ...props }: ComponentPropsWithoutRef<'article'> & { featured?: boolean }) {
  return <article {...props} className={`plan-card-surface ${className}`} data-featured={featured} />;
}

export function PlanHighlights({ pro = false, earlyAccess = false }: { pro?: boolean; earlyAccess?: boolean }) {
  return <dl className="plan-highlights" aria-label={`${pro ? 'Pro' : 'Free'} plan at a glance`}>
    <div><dt>Cloud storage</dt><dd>{pro ? '2 GB' : '200 MB'}</dd></div>
    <div><dt>Built-in processing</dt><dd>{pro || earlyAccess ? <>500 credits<span>per month</span></> : <>Not included<span>Bring your own agent</span></>}</dd></div>
    <div><dt>Collections you can create</dt><dd>{pro || earlyAccess ? 'Personal + groups' : 'Personal'}</dd></div>
  </dl>;
}
