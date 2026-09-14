import type {ReactNode} from 'react';
import Link from 'next/link';
import '@/app/customer.css';

export function AuthShell({children, headingId}: {children: ReactNode; headingId?: string}) {
  return <div className="customer-body auth-body auth-app">
    <a className="skip-link" href="#main">Skip to account form</a>
    <main id="main" className="auth-layout">
      <section className="auth-story" aria-label="Your FoundKeep collection">
        <img className="auth-landscape" src="/assets/scenic-mountains-800.webp" srcSet="/assets/scenic-mountains-800.webp 800w, /assets/scenic-mountains-1600.webp 1600w" sizes="(max-width: 680px) 100vw, 50vw" width={1600} height={1000} alt="" fetchPriority="high"/>
        <Link className="brand auth-story-brand" href="/"><img src="/assets/studio-mark.svg?v=bookmark-evolved-1" width={32} height={32} alt=""/><span>FoundKeep</span></Link>
        <div className="auth-story-copy"><h1>Good finds.<br/>A place to<br/>come back to.</h1><p>Save what catches your eye.<br/>Find it here, whenever you need it.</p></div>
        <div className="auth-story-note"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M6 3h12v18l-6-4-6 4Z"/></svg><span>Your pages, pictures and ideas.<br/><strong>One personal collection.</strong></span></div>
      </section>
      <section className="auth-panel" aria-labelledby={headingId} aria-label={headingId ? undefined : 'Your FoundKeep account'}>
        {children}
        <noscript><p className="form-message is-error">JavaScript is required to create an account or log in. Enable it, then reload this page.</p></noscript>
      </section>
    </main>
    <footer className="account-footer"><span>Your collection, wherever you go.</span><Link href="/privacy">Privacy &amp; data</Link></footer>
  </div>;
}
