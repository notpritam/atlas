'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useDashboard } from './context';
import { PageHeading } from './page-heading';
import { SectionLoading, Spinner } from './loading';
import { dateLabel } from '../../lib/dashboard';
import { useEntrance } from './motion';
import './agents.css';

type Agent = { id: string; name: string; scopes: string[]; expiresAt: number; lastSeenAt: number | null };
type Connections = { agents: Agent[]; nudges: { id: string; text: string; status: string }[] };

export default function Agents() {
  const setup = useEntrance<HTMLDivElement>(true, ':scope > *');
  const { me, request, confirm, toast } = useDashboard();
  const cache = useQueryClient();
  const account = me.account.id;
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const [name, setName] = useState('My agent');
  const [write, setWrite] = useState(false);
  const [files, setFiles] = useState(false);
  const [secret, setSecret] = useState('');
  const [nudge, setNudge] = useState('');
  const agents = useQuery({ queryKey: ['agents', account], queryFn: ({ signal }) => request<Connections>('/agents', { signal }), refetchInterval: 30000 });
  const update = () => cache.invalidateQueries({ queryKey: ['agents', account] });
  const action = useMutation({ mutationFn: async ({ kind, id }: { kind: 'create' | 'revoke' | 'nudge'; id?: string }) => {
    if (kind === 'create') {
      const result = await request<{ token: string }>('/agents', { method: 'POST', body: { name: name.trim(), days: 90, scopes: ['library:read', ...(files ? ['files:read'] : []), ...(write ? ['library:write'] : [])] } });
      if (alive.current) setSecret(result.token);
    }
    if (kind === 'revoke') await request('/agents/' + encodeURIComponent(id!), { method: 'DELETE' });
    if (kind === 'nudge') {
      await request('/agents/nudges', { method: 'POST', body: { text: nudge } });
      if (alive.current) { setNudge(''); toast('Instruction saved for your connected agent.'); }
    }
    await update();
  } });
  const busy = action.isPending;
  const connections = agents.data?.agents;
  const instructions = agents.data?.nudges.filter(item => item.status === 'pending') || [];
  const config = secret ? JSON.stringify({ mcpServers: { [window.location.hostname === 'dev.foundkeep.app' ? 'foundkeep-dev' : 'foundkeep']: { type: 'http', url: `${window.location.origin}/api/mcp`, headers: { Authorization: 'Bearer ' + secret } } } }, null, 2) : '';
  const copy = async () => {
    try { await navigator.clipboard.writeText(config); toast('Configuration copied.'); }
    catch { toast('Select the configuration and copy it manually.'); }
  };

  return <><PageHeading title="Agent connections" description="Bring your own agent to your collection. Find, read, and organize your saved ideas with an MCP-compatible client." />
    <div ref={setup} className="agent-setup-layout">
      <section className="agent-connect" aria-labelledby="connect-agent-title">
        <div className="agent-section-heading"><h2 id="connect-agent-title">Connect an agent</h2><span className="agent-plan-label">Free &amp; Pro</span></div>
        <p className="muted">Name your connection and choose what it can access.</p>
        <form id="agent-connection-form" className="service-form" aria-busy={busy && action.variables?.kind === 'create'} onSubmit={event => { event.preventDefault(); if (!busy && !secret) action.mutate({ kind: 'create' }); }}>
          <fieldset disabled={busy || Boolean(secret)}>
            <label className="field" htmlFor="agent-name">Connection name<input id="agent-name" value={name} maxLength={60} required onChange={event => setName(event.target.value)} /></label>
            <div className="agent-access-included"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="m5 12 4 4L19 6" /></svg><div><strong>Read your library</strong><p>Saved text, source information, tags, and folders. Included with every connection.</p></div></div>
            <label className="check-field"><input id="agent-files" type="checkbox" checked={files} onChange={event => setFiles(event.target.checked)} /><span><strong>Read original images and files</strong><small>Allow access to the original files in your collection.</small></span></label>
            <label className="check-field"><input id="agent-write" type="checkbox" checked={write} onChange={event => setWrite(event.target.checked)} /><span><strong>Add and organize saves</strong><small>Allow new saves, edits to titles, notes and summaries, and changes to tags, folders and connections.</small></span></label>
          </fieldset>
          <button id="create-agent-connection" className="button primary" disabled={busy || Boolean(secret) || !name.trim()}>{busy && action.variables?.kind === 'create' ? <><Spinner />Creating connection…</> : 'Create connection'}</button>
          <p className="field-help">Grant access only to an agent you trust. Connections expire after 90 days.</p>
        </form>
        {action.error && action.variables?.kind === 'create' ? <p className="form-message is-error" role="alert">{action.error.message}</p> : null}
      </section>
      <aside className="agent-guide" aria-labelledby="agent-guide-title"><h2 id="agent-guide-title">Your agent. Your workflow.</h2><p>Connect an MCP client to work with your library using its own model and tools.</p><ol><li><strong>Choose its access</strong><span>Start with reading. Add file access or organization only when you need it.</span></li><li><strong>Add the connection</strong><span>Copy the configuration into a client that supports HTTP MCP and an Authorization header.</span></li><li><strong>Put your saves to work</strong><span>Ask your agent to save a useful article, add context to existing notes, and link related ideas in your mind map.</span></li></ol><p className="agent-guide-note">Your agent controls its model, schedule, and any costs. MCP connections are available on both Free and Pro.</p></aside>
    </div>
    {secret ? <section className="agent-secret" aria-labelledby="agent-secret-title"><h2 id="agent-secret-title">Save your connection privately.</h2><p className="field-help">This credential is shown once. Copy it into your MCP client before leaving this page.</p><textarea aria-label="Private MCP configuration" autoFocus readOnly value={config} rows={11} spellCheck={false} /><div className="service-actions"><button className="button primary compact" onClick={() => void copy()}>Copy configuration</button><button className="button secondary compact" onClick={() => setSecret('')}>I saved it</button></div></section> : null}
    <section className="agent-connections" aria-labelledby="connected-agents-title"><div className="agent-section-heading"><div><h2 id="connected-agents-title">Connected agents{connections ? <span className="agent-count">{connections.length}</span> : null}</h2><p className="muted">Review access or disconnect an agent at any time.</p></div><button className="button secondary compact" aria-busy={agents.isFetching} disabled={agents.isFetching || busy} onClick={() => void agents.refetch()}>{agents.isFetching && !agents.isPending ? <><Spinner />Refreshing…</> : 'Refresh connections'}</button></div>
      {agents.isPending ? <SectionLoading label="Loading agent connections…" /> : null}
      {agents.isError ? <p className="form-message is-error" role="alert">{agents.error.message} <button className="subtle-button" onClick={() => void agents.refetch()}>Try again</button></p> : null}
      {connections?.length === 0 ? <div className="agent-empty"><h3>No agents connected yet.</h3><p>Create a connection above to let your own agent work with your saves.</p></div> : null}
      {connections?.length ? <ul id="agent-connections" className="agent-connection-list">{connections.map(agent => <li key={agent.id} data-agent-id={agent.id}><div><h3>{agent.name}</h3><p>{agent.scopes.includes('library:write') ? 'Can organize' : 'Read only'}{agent.scopes.includes('files:read') ? ' · Original files' : ''}</p><p className="field-help">Expires {dateLabel(agent.expiresAt)} · {agent.lastSeenAt ? `Last used ${dateLabel(agent.lastSeenAt, true)}` : 'Not used yet'}</p></div><button className="button danger-quiet compact" aria-label={`Revoke ${agent.name}`} disabled={busy} onClick={async () => { if (await confirm('Disconnect this agent?', agent.name + ' will immediately lose access to your library.', 'Revoke access')) action.mutate({ kind: 'revoke', id: agent.id }); }}>{busy && action.variables?.kind === 'revoke' && action.variables.id === agent.id ? <><Spinner />Revoking…</> : 'Revoke access'}</button></li>)}</ul> : null}
      {action.error && action.variables?.kind === 'revoke' ? <p className="form-message is-error" role="alert">{action.error.message}</p> : null}
    </section>
    {connections?.length || instructions.length ? <section className="agent-instructions" aria-labelledby="agent-instructions-title"><h2 id="agent-instructions-title">Instructions for your agent</h2>{connections?.length ? <form className="service-form" onSubmit={event => { event.preventDefault(); if (!busy) action.mutate({ kind: 'nudge' }); }}><label className="field" htmlFor="agent-instruction">What would you like it to do?<textarea id="agent-instruction" value={nudge} onChange={event => setNudge(event.target.value)} maxLength={1000} required rows={3} placeholder="Organize my recent design references into a folder…" /></label><button className="button secondary compact" disabled={busy || !nudge.trim()}>{busy && action.variables?.kind === 'nudge' ? <><Spinner />Saving…</> : 'Save instruction'}</button><p className="field-help">Your agent receives this when it next checks FoundKeep. Keep it running to handle new saves automatically.</p></form> : null}{action.error && action.variables?.kind === 'nudge' ? <p className="form-message is-error" role="alert">{action.error.message}</p> : null}{instructions.length ? <ul className="agent-instruction-list" aria-label="Pending instructions">{instructions.map(item => <li key={item.id}><span>Waiting for your agent</span><p>{item.text}</p></li>)}</ul> : null}</section> : null}
  </>;
}
