'use client';
import { useMutation } from '@tanstack/react-query';
import { dateLabel, messageFor } from '../../lib/dashboard';
import { Spinner } from './loading';
import { useDashboard } from './context';
export function Connections() {
  const { me, request, confirm, refreshAccount, detectExtension, toast } = useDashboard();
  const accountAction = useMutation({ mutationFn: async ({ id }: { kind: 'revoke'; id: string }) => {
    await request(`/connections/${encodeURIComponent(id)}`, { method: 'DELETE' });
    await Promise.all([refreshAccount(), detectExtension()]);
    toast('Device access revoked.');
  } });
  const pending = accountAction.isPending;
  return <><section className="settings-section"><h3>Connected apps &amp; devices</h3><p className="muted">Manage the devices signed in to this account. Revoking access disconnects that device from your cloud library.</p><ul className="device-list" id="device-list">{me.connections.length ? me.connections.map(connection => <li key={connection.id}><div><strong>{connection.name || 'Foundkeep device'}</strong><span>Connected {dateLabel(connection.createdAt)} · {connection.lastSeenAt ? `Last active ${dateLabel(connection.lastSeenAt, true)}` : 'Not used yet'}</span></div><button className="subtle-button danger-text" type="button" aria-label={`Revoke ${connection.name || 'Foundkeep device'}`} disabled={pending} onClick={async () => { if (await confirm('Disconnect this device?', `${connection.name || 'This device'} will lose access to your cloud library. Its local captures remain on that device.`, 'Revoke access')) accountAction.mutate({ kind: 'revoke', id: connection.id }); }}>{pending && accountAction.variables?.id === connection.id ? <><Spinner />Revoking…</> : 'Revoke'}</button></li>) : <li className="muted device-empty">No apps or browsers connected yet.</li>}</ul></section>{accountAction.error ? <p className="form-message is-error" role="alert">{messageFor(accountAction.error)}</p> : null}</>;
}
