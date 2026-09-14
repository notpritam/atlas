import type { ComponentProps } from 'react';

export function ExternalIcon() {
  return <svg className="external-link-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M7 17 17 7M7 7h10v10" /></svg>;
}
export function ExternalLink({ children, className = '', ...props }: ComponentProps<'a'>) {
  return <a {...props} className={`external-link ${className}`} target="_blank" rel="noopener noreferrer">{children}<ExternalIcon /><span className="sr-only"> (opens in a new tab)</span></a>;
}
