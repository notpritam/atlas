'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { bytes } from '../../lib/dashboard';
import { useDashboard } from './context';
import { ContentSkeleton, Spinner } from './loading';
import { gsap, motionAllowed, useEntrance, useGSAP } from './motion';
import { PlanCard, PlanHighlights } from '../ui/plan-card';
import { PageHeading } from './page-heading';

type Subscription = { provider: 'paddle' | 'stripe' | 'revenuecat'; active: boolean; status: string; renews: boolean; expiresAt: number };
type Plan = {
  pro: boolean;
  earlyAccess?: boolean;
  features?: { managedProcessing: boolean };
  subscriptions: Subscription[];
  limits: { maxBytes: number; maxCaptures: number; monthlyProcessing: number };
  price: { currency: string; monthly: number };
  billing: { paddle: { available: boolean; canManage: boolean }; stripe: { available: boolean; canManage: boolean } };
};
type Processing = { available: boolean; usage: { cycle: string; used: number; reserved: number; limit: number } };
const number = (value: number) => value.toLocaleString('en-US');
const date = (value: number) => new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' }).format(value);

function UsageMeter({ label, used, limit, value, help }: { label: string; used: number; limit: number; value: string; help: string }) {
  const percent = limit > 0 ? Math.min(100, Math.max(0, used / limit * 100)) : 0;
  const bar = useRef<HTMLSpanElement>(null);
  useGSAP(() => {
    if (!bar.current) return;
    const media = gsap.matchMedia();
    media.add(motionAllowed, () => { gsap.from(bar.current, { scaleX: 0, duration: 0.5, ease: 'power2.out', clearProps: 'transform' }); });
    return () => media.revert();
  }, { scope: bar, dependencies: [percent], revertOnUpdate: true });
  return <div className="usage-meter"><h3>{label}</h3><p className="usage-value">{value}</p><div className={`usage-track${percent >= 90 ? ' near-limit' : ''}`} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={Math.max(1, limit)} aria-valuenow={Math.min(Math.max(0, used), Math.max(1, limit))} aria-valuetext={`${value}. ${help}`}><span ref={bar} style={{ width: `${percent}%` }} /></div><p className="field-help">{help}</p></div>;
}
function Benefits({ items }: { items: { title: string; description: string }[] }) {
  return <ul className="plan-benefits">{items.map(item => <li key={item.title}><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 4 4L19 6" /></svg><span><strong>{item.title}</strong><span className="plan-benefit-description">{item.description}</span></span></li>)}</ul>;
}

export default function Plans() {
  const { me, request, refreshAccount, toast } = useDashboard();
  const cache = useQueryClient();
  const billingResult = useSearchParams().get('billing');
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const plan = useQuery({ queryKey: ['plan', me.account.id], queryFn: ({ signal }) => request<Plan>('/plan', { signal }), refetchInterval: query => billingResult === 'success' && !query.state.data?.pro ? 5000 : 30000 });
  const processing = useQuery({ queryKey: ['automation', me.account.id], queryFn: ({ signal }) => request<Processing>('/automation', { signal }), refetchInterval: 30000 });
  const refresh = async () => {
    await Promise.all([refreshAccount(), cache.invalidateQueries({ queryKey: ['plan', me.account.id] }), cache.invalidateQueries({ queryKey: ['automation', me.account.id] })]);
  };
  const action = useMutation({ mutationFn: async (kind: 'checkout' | 'portal' | 'sync') => {
    if (kind === 'sync') {
      const provider = plan.data?.subscriptions.find(subscription => subscription.active)?.provider;
      if (provider || plan.data?.billing.paddle.available) await request(`/billing/${provider || 'paddle'}/sync`, { method: 'POST', body: {} });
      await refresh();
      if (alive.current) toast('Your plan and usage are up to date.');
      return;
    }
    const result = await request<{ url: string }>(`/billing/${kind}`, { method: 'POST', body: {} });
    if (!alive.current) return;
    const destination = new URL(result.url, window.location.origin);
    const localCheckout = destination.origin === window.location.origin && destination.pathname === '/checkout';
    const paddle = destination.protocol === 'https:' && /(^|\.)paddle\.com$/.test(destination.hostname);
    if ((!localCheckout && !paddle) || destination.username || destination.password) throw new Error('The payment destination is unavailable. Please try again.');
    window.location.assign(destination.href);
  } });
  const data = plan.data;
  const content = useEntrance<HTMLDivElement>(Boolean(data), ':scope > section');
  const usage = processing.data?.usage;
  const activeSubscription = data?.subscriptions.find(subscription => subscription.active);
  const needsAttention = data?.subscriptions.some(subscription => !subscription.active && !['inactive', 'canceled', 'incomplete_expired'].includes(subscription.status));
  const price = data ? new Intl.NumberFormat('en-US', { style: 'currency', currency: data.price.currency, maximumFractionDigits: 0 }).format(data.price.monthly) : null;
  const canCheckout = Boolean(data && !data.pro && !needsAttention && data.billing.paddle.available && processing.data?.available);
  const busy = action.isPending;
  // The URL reports a checkout return; only the account's verified plan grants Pro.
  const message = billingResult === 'success' ? (data?.pro ? 'Your Pro plan is ready. Enjoy more room for your collection.' : 'Checkout completed. We’re waiting for your subscription to be verified. Refresh your plan if this takes a moment.') : billingResult === 'cancelled' ? 'Checkout closed. Your current plan is unchanged.' : '';

  return <><PageHeading title="Plans & usage" description={data?.earlyAccess?"All features are available during early access. Choose Pro for more cloud storage.":"Start with a library you control. Add Pro when you want FoundKeep to process and organize your saves."} />
    {message ? <p className="billing-notice" role="status">{message}</p> : null}
    {!data ? <section className="plan-loading" role="status" aria-busy={plan.isPending}><h2>{plan.isError ? 'Your plan couldn’t load.' : 'Loading your plan…'}</h2><p className="muted">{plan.error?.message || 'Checking your subscription and collection limits.'}</p>{plan.isPending ? <ContentSkeleton kind="plan" /> : null}{plan.isError ? <button className="button secondary compact" onClick={() => void plan.refetch()}>Try again</button> : null}</section> : <div ref={content}>
      <section className="plan-overview" aria-labelledby="current-plan-title"><div className="plan-overview-heading"><div><h2 id="current-plan-title">Your {data.pro ? 'Pro' : 'Free'} plan</h2><p>{activeSubscription ? `${activeSubscription.renews ? 'Renews' : 'Access until'} ${date(activeSubscription.expiresAt)} · ${activeSubscription.provider === 'revenuecat' ? 'App Store' : 'Web subscription'}` : 'A private home for your collection, across every device.'}</p></div><button className="button secondary compact" disabled={busy} onClick={() => action.mutate('sync')}>{busy && action.variables === 'sync' ? <><Spinner />Refreshing…</> : 'Refresh plan'}</button></div>
        {needsAttention ? <p className="form-message is-error" role="status">Your subscription needs attention. Manage your subscription to check its payment status before starting another plan.</p> : null}
        <div className="usage-grid">
          <UsageMeter label="Cloud storage" used={me.usage.bytes} limit={data.limits.maxBytes} value={`${bytes(me.usage.bytes)} / ${bytes(data.limits.maxBytes)}`} help={me.usage.bytes > data.limits.maxBytes ? 'Storage limit reached. Free up space or upgrade to keep uploading.' : 'Space used by your saved content and files.'} />
          <UsageMeter label="Saved captures" used={me.usage.captures} limit={data.limits.maxCaptures} value={`${number(me.usage.captures)} / ${number(data.limits.maxCaptures)}`} help="Pages, highlights, images, notes, and more." />
          {usage ? <UsageMeter label="Processing credits" used={usage.used + usage.reserved} limit={data.limits.monthlyProcessing} value={data.features?.managedProcessing ? `${number(usage.used)} / ${number(data.limits.monthlyProcessing)}` : 'Included with Pro'} help={data.features?.managedProcessing ? `${number(usage.reserved)} queued · Resets each month (UTC).` : '500 monthly credits for organization and video preservation.'} /> : <div className="usage-meter"><h3>Processing credits</h3><p className="muted" role="status">{processing.isError ? 'Credit usage is unavailable.' : 'Loading credit usage…'}</p>{processing.isError ? <button className="subtle-button" onClick={() => void processing.refetch()}>Retry credit usage</button> : null}</div>}
        </div>
        <div className="plan-management">{data.billing.paddle.canManage ? <button className="text-link subtle-button" disabled={busy} onClick={() => action.mutate('portal')}>{busy && action.variables === 'portal' ? <><Spinner />Opening billing…</> : 'Manage subscription'}</button> : null}{data.subscriptions.some(subscription => subscription.provider === 'revenuecat') ? <a className="text-link" href="https://apps.apple.com/account/subscriptions" target="_blank" rel="noopener noreferrer">Manage in your Apple Account <span aria-hidden="true">↗</span></a> : null}{data.features?.managedProcessing ? <Link className="text-link" href="/dashboard/settings/processing">Processing settings <span aria-hidden="true">→</span></Link> : null}</div>
      </section>
      {action.error ? <p className="form-message is-error" role="alert">{action.error.message}</p> : null}
      <section className="plan-options" aria-labelledby="compare-plans-title"><div className="plan-options-heading"><h2 id="compare-plans-title">{data.earlyAccess?<>All features.<br />More room with Pro.</>:<>Your agent on Free.<br />FoundKeep’s processing on Pro.</>}</h2><p>{data.earlyAccess?"MCP, groups, and managed processing are open on every plan while we build FoundKeep together.":"Both plans give you control of your library. Choose who does the organizing."}</p></div>
        <div className="plan-grid">
          <PlanCard className="plan-card" data-plan="free">
            <div className="plan-card-heading"><h3>Free</h3>{!data.pro ? <span className="current-plan-label">Current plan</span> : null}</div>
            <p className="plan-description">A working library. An agent you control.</p>
            <p className="plan-price">$0 <span>/ always</span></p><p className="plan-price-note">No FoundKeep subscription required.</p>
            <PlanHighlights earlyAccess={data.earlyAccess} />
            <Benefits items={[
              { title: 'Save and organize your everyday finds', description: 'Keep up to 10,000 pages, images, highlights, and notes. Import bookmarks and organize them with folders and tags.' },
              { title: 'Connect your own agent', description: 'MCP access is included. Choose your agent’s model, instructions, schedule, and permissions.' },
              { title: 'Let your agent make real changes', description: 'With organization access, it can create folders, update tags, and link related saves directly in your library.' },
              { title: 'Curate and follow collections', description: 'Create public or private personal collections, accept contributions, and follow other people’s finds. Joining a group is free.' },
              { title: 'Keep your collection with you', description: 'Access your synced library from the browser, iPhone, and web.' },
            ]} />
            <p className="plan-boundary">{data.earlyAccess?"Managed processing and group creation are included during early access. Any costs for your own agent or model provider are separate.":"FoundKeep-managed image and link processing require Pro. Any costs for your own agent or model provider are separate."}</p>
            <div className="plan-card-action">{data.pro ? <p className="field-help">To switch to Free, manage your subscription above. Your paid access continues until its expiry date.</p> : <span className="plan-current-state"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="m5 12 4 4L19 6" /></svg>You’re on Free</span>}<Link className="text-link plan-agent-link" href="/dashboard/agents">Connect your own agent <span aria-hidden="true">→</span></Link></div>
          </PlanCard>
          <PlanCard featured className="plan-card pro-plan" data-plan="pro">
            <div className="plan-card-heading"><h3>Pro</h3>{data.pro ? <span className="current-plan-label">Current plan</span> : <span className="plan-extra-label">{data.earlyAccess?"10× cloud storage":"FoundKeep does the processing"}</span>}</div>
            <p className="plan-description">Turn saved content into useful context.</p>
            <p className="plan-price">{price} <span>/ month</span></p><p className="plan-price-note">{data.price.currency} · Billed monthly. Cancel anytime.</p>
            <PlanHighlights pro earlyAccess={data.earlyAccess} />
            <p className="plan-includes">{data.earlyAccess?"2 GB of cloud storage, with all early-access features:":"Everything in Free, plus:"}</p>
            <Benefits items={[
              { title: 'Build a collection with your people', description: 'Create public or private groups. Invite contributors and moderators, set community rules, and approve submissions.' },
              { title: 'Understand images and screenshots', description: 'Let FoundKeep analyze your saved images to suggest summaries and tags. You choose whether images are included.' },
              { title: 'Get more from your saved links', description: 'With your permission, FoundKeep reads accessible public pages to add context to your saves.' },
              { title: 'Have your collection organized for you', description: 'Get concise summaries, suggested tags, and connections between related saves, without running your own agent.' },
            ]} />
            <div className="plan-control-note"><strong>You decide what gets processed.</strong><p>Enable processing, choose image and link access, and turn it off anytime. Your originals and personal tags stay intact.</p></div>
            <div className="plan-card-action">{data.pro ? <Link className="button primary wide" href="/dashboard/settings/processing">Set up processing <span aria-hidden="true">→</span></Link> : <><button className="button primary wide" disabled={busy || !canCheckout} onClick={() => action.mutate('checkout')}>{busy && action.variables === 'checkout' ? <><Spinner />Opening checkout…</> : needsAttention ? 'Manage your existing subscription' : canCheckout ? `Get Pro · ${price}/month` : 'Pro checkout unavailable'}</button>{!canCheckout ? <p className="field-help">{needsAttention ? 'Use the subscription controls above to review your plan.' : 'Checkout is temporarily unavailable. Try refreshing your plan shortly.'}</p> : null}</>}</div>
          </PlanCard>
        </div>
        <p className="plan-footnote">Web pricing is in {data.price.currency}; applicable taxes are shown at checkout. App Store pricing is localized. Pro follows your FoundKeep account across all devices.</p>
      </section>
      <section className="plan-roadmap" aria-labelledby="plan-roadmap-title">
        <div className="plan-roadmap-heading"><h2 id="plan-roadmap-title">Keep an available video copy</h2><span className="plan-roadmap-label">With Pro processing</span></div>
        <p className="plan-roadmap-description">With managed processing and public link access enabled, FoundKeep can try to preserve public videos up to 50 MiB and 30 minutes. Availability depends on the source and processing setup.</p>
        <dl className="plan-media-list">
          <div><dt>YouTube</dt><dd>Public video copies</dd><dd className="plan-media-status">When accessible</dd></div>
          <div><dt>Instagram</dt><dd>Video downloads</dd><dd className="plan-media-status">When accessible</dd></div>
          <div><dt>X / Twitter</dt><dd>Video downloads</dd><dd className="plan-media-status">When accessible</dd></div>
        </dl>
        <p className="plan-roadmap-footnote">Saving a link alone does not download it. Processing tries an available video copy; sign-in walls and unsupported sources may prevent it. The saved item shows whether bytes were preserved.</p>
      </section>
      <section className="plan-details" aria-labelledby="plan-details-title"><h2 id="plan-details-title">Before you choose</h2><details><summary>Can my own agent make changes on Free?</summary><p>Yes. Both plans include MCP access. Give your agent organization permission to create folders, update tags, and connect related saves. Those changes are saved back to your FoundKeep library. You control its instructions and can revoke access in <Link className="text-link" href="/dashboard/agents">Agent connections</Link>. Your agent’s model and hosting costs are separate from FoundKeep.</p></details><details><summary>How do Pro processing credits work?</summary><p>Pro includes 500 managed processing credits per UTC calendar month. A successful processing job uses one credit, including video preservation when there is no readable text or consented image to organize. Queued jobs reserve credits; failed or cancelled jobs do not use them. Enable processing in Settings before any selected content is sent to OpenAI. Your own agent’s work does not use these credits unless it requests FoundKeep-managed processing.</p></details><details><summary>What happens if I return to Free?</summary><p>Your existing saves and own-agent access remain. Free includes 200 MB of cloud storage; new uploads may be limited if you’re over that allowance. FoundKeep-managed processing stops when your Pro access ends.</p></details></section>
    </div>}
  </>;
}
