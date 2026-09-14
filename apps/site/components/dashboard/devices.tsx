'use client';
import { useEffect, useRef, useState } from 'react';
import { customerConfig, DEFAULT_CONFIG, defaultCustomerConfig, extensionMessage, isIphoneBrowser, isMobileBrowser } from '../../lib/platforms';
import { messageFor } from '../../lib/dashboard';
import Link from 'next/link';
import { PageHeading } from './page-heading';
import { Spinner } from './loading';
import { Connections } from './connections';
import { PlatformIcon } from '../ui/platform-icon';
import { useDashboard } from './context';
export default function Devices() {
  const { me, extension, detectExtension, request, confirm, refreshAccount, toast } = useDashboard();
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [mobile, setMobile] = useState(false);
  const [iphone, setIphone] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const connectingRef = useRef(false);
  const [status, setStatus] = useState('');
  const [manualOpen, setManualOpen] = useState(false);
  const [copyResult, setCopyResult] = useState('');
  const devExtension = config.extensionEnvironment === 'dev';
  const extensionDownload = devExtension ? '/ext/foundkeep-extension-dev.zip' : '/foundkeep-extension.zip';
  const connected = extension?.result.account?.id === me.account.id;
  const phones = me.connections.filter(connection => connection.clientKind === 'mobile');
  const unknown = me.connections.some(connection => !connection.clientKind || connection.clientKind === 'unknown');
  useEffect(() => { let active = true; setMobile(isMobileBrowser()); setIphone(isIphoneBrowser()); setConfig(defaultCustomerConfig()); void customerConfig().then(value => { if (active) setConfig(value); }); return () => { active = false; }; }, []);
  useEffect(() => { setStatus(''); }, [extension]);
  const extensionStatus = status || (connected ? `Connected as ${extension?.result.account?.email}. New captures sync to this library.` : extension?.result.account ? `This browser is connected to ${extension.result.account.email}. Confirm before switching accounts.` : extension ? 'FoundKeep is installed. Connect it to start syncing new captures.' : mobile ? 'The browser extension is for your computer. On iPhone, use the app and Share menu.' : 'FoundKeep isn’t detected. Install it in a supported Chromium browser, then reload this page. If it’s already installed, reload it from the browser’s extensions page.');
  const connect = async () => {
    if (connectingRef.current) return;
    connectingRef.current = true; setConnecting(true);
    try {
      const detected = await detectExtension();
      if (!detected) { setManualOpen(true); throw new Error('Install or reload FoundKeep in Chrome first. Then reload this page and connect again.'); }
      const owner = detected.result.account;
      if (owner && owner.id !== me.account.id && !await confirm('Switch this browser’s account?', `FoundKeep is connected to ${owner.email}. New captures will sync to ${me.account.email} after switching. Captures waiting to upload for the previous account stay with that account.`, 'Switch account')) return;
      setStatus('Connecting your browser…');
      const pairing = await request<{ code: string }>('/pairing', { method: 'POST', body: {} });
      const result = await extensionMessage<{ account?: { id: string; email: string } }>({ kind: 'atlas-connect', code: pairing.code }, detected.id);
      if (result.account?.id !== me.account.id) throw new Error('The extension connected to a different account. Reload this page and reconnect.');
      await Promise.all([refreshAccount(), detectExtension()]);
      setStatus(`Connected as ${result.account.email}. Your next capture will sync here.`);
      toast('Browser connected. Save your first find with FoundKeep.');
    } catch (error) { setStatus(messageFor(error)); }
    finally { connectingRef.current = false; setConnecting(false); }
  };
  const phoneOption = <section key="iphone" className="device-option iphone-option" aria-labelledby="iphone-title"><div className="device-option-heading"><PlatformIcon platform="ios" /><h3 id="iphone-title">On your iPhone</h3><span className="device-badge" data-iphone-badge>{config.iphone.badge}</span></div><p>From your day to your collection. Share links, photos and files straight to FoundKeep.</p><p id="iphone-status" className={`device-connection${phones.length ? ' connection-success' : ''}`} role="status">{phones.length ? `iPhone app connected to this account${phones.length > 1 ? ` on ${phones.length} devices` : ''}.` : unknown ? 'No iPhone connection confirmed yet. Open the app to refresh an existing connection.' : 'No iPhone app connected to this account yet.'}</p><div className="device-actions"><a className={phones.length ? 'text-link' : 'button primary compact'} data-iphone-install id="install-iphone" href={config.iphone.url}>{phones.length ? 'Install on another iPhone' : config.iphone.label}</a><a className={phones.length ? 'button primary compact' : 'text-link'} id="open-iphone" href="/open?path=collection">{phones.length ? 'Open the app on iPhone' : 'Already installed? Open app'}</a></div><p className="step-note" id="iphone-signin-note">{phones.length ? 'Your app and this dashboard share one collection. New saves sync when you’re online.' : 'Sign in to the app with the same FoundKeep account. Your saves will appear here.'}</p><ol className="iphone-share-steps"><li>Open Share in Safari, Photos or Files.</li><li>Choose FoundKeep, add a tag or folder, and save.</li><li>Find it in this collection on any connected device.</li></ol><a className="text-link" href="/support#iphone">Help with the Share menu</a></section>;
  const browserOption = <section key="browser" className="device-option browser-option" aria-labelledby="browser-title"><div className="device-option-heading"><PlatformIcon platform="chrome" /><h3 id="browser-title">In your browser</h3><span className="device-badge" id="browser-connection-badge">{connected ? 'Connected here' : extension ? 'Installed here' : mobile ? 'For your computer' : 'Not connected here'}</span></div><p>Keep the page, the highlight, the moment.</p><ol className="onboarding-steps"><li><span className={`step-marker${extension ? ' step-done' : ''}`} id="install-marker">1</span><div><h3>Install {devExtension ? 'FoundKeep Dev' : 'FoundKeep'}</h3><p id="install-description">{devExtension ? 'Download the dev extension and load it unpacked in Chrome. Its saves and account stay in dev, separate from your production extension.' : 'Use Chrome on your computer to add FoundKeep from the Chrome Web Store, then pin it in your extensions menu.'}</p><a className="text-link" id="install-extension" href={devExtension ? extensionDownload : config.storeUrl} download={devExtension ? 'foundkeep-extension-dev.zip' : undefined} target={devExtension ? undefined : '_blank'} rel="noopener noreferrer">{devExtension ? 'Download FoundKeep Dev' : 'Add to Chrome'} <span aria-hidden="true">↗</span></a><details className="manual-install" id="manual-install" open={manualOpen || devExtension} onToggle={event => setManualOpen(event.currentTarget.open)}><summary>{devExtension ? 'Install or update FoundKeep Dev' : 'Need the manual ZIP?'}</summary><ol><li><a href={extensionDownload} download={devExtension ? 'foundkeep-extension-dev.zip' : 'foundkeep-extension.zip'}>Download {devExtension ? 'FoundKeep Dev' : 'FoundKeep'}</a> and extract the ZIP into a folder you can keep.</li><li>Open your browser’s extensions page, such as <code>chrome://extensions</code> or <code>edge://extensions</code>.</li><li>Enable <strong>Developer mode</strong>. Choose <strong>Load unpacked</strong> and select the extracted folder.</li><li>Pin {devExtension ? 'FoundKeep Dev' : 'FoundKeep'} in your browser’s extensions menu, then reload this page.</li></ol><button className="subtle-button" id="copy-extensions" type="button" onClick={async () => { try { await navigator.clipboard.writeText('chrome://extensions'); setCopyResult('Copied. Paste it into Chrome’s address bar.'); } catch { setCopyResult('Copy chrome://extensions and paste it into Chrome’s address bar.'); } }}>Copy Chrome extensions address</button><p id="copy-result" role="status">{copyResult}</p></details></div></li><li><span className={`step-marker${connected ? ' step-done' : ''}`} id="connect-marker">2</span><div><h3>Connect this browser</h3><p id="extension-status" className={connected ? 'connection-success' : ''} role="status">{extensionStatus}</p><button className="button secondary compact" id="connect-extension" type="button" hidden={mobile} disabled={connecting} onClick={() => void connect()}>{connecting ? <><Spinner />Connecting…</> : connected ? 'Reconnect FoundKeep' : extension?.result.account ? 'Switch FoundKeep account' : 'Connect FoundKeep'}</button><p className="step-note">Existing local captures stay local. You can choose to import them in the extension.</p></div></li></ol></section>;
  return <><PageHeading title="Apps & devices" description="Your collection goes with you. Connect your browser and iPhone to keep your finds in sync." />{devExtension?<div className="account-page-note"><p>Joining the friends beta? Find dev installation links and a short test guide.</p><Link className="text-link" href="/beta">Open the beta guide →</Link></div>:null}<section className="apps-setup" id="onboarding" aria-label="Install and connect FoundKeep"><div className="device-options">{iphone ? [phoneOption, browserOption] : [browserOption, phoneOption]}</div></section><Connections /><div className="account-page-note"><p>Want to connect your own agent?</p><Link className="text-link" href="/dashboard/agents">Open Agent connections <span aria-hidden="true">→</span></Link></div></>;
}
