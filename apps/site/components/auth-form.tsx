'use client';

import Link from 'next/link';
import {useEffect, useRef, useState, type FormEvent, type MouseEvent} from 'react';
import {api, downloadBlob} from '@/lib/api';
import type {Account} from '@/lib/types';
import type {OAuthProvider} from '@/lib/oauth';
import {OAuthButtons} from './auth-oauth-buttons';

export type AuthMode = 'signup' | 'login' | 'recover';
export const authViews = {
  signup: {title: 'Keep the good things.', description: 'Sign in or create an account. Your collection comes with you.', action: 'Create account'},
  login: {title: 'Welcome back.', description: 'Your good finds are right where you left them.', action: 'Log in'},
  recover: {title: 'A way back in.', description: 'Use your saved recovery code to choose a new password. This disconnects your browsers and signs out your other sessions.', action: 'Recover account'},
};

function RecoverySave({code, email}: {code: string; email: string}) {
  const [saved, setSaved] = useState(false);
  const [downloadError, setDownloadError] = useState('');
  const title = useRef<HTMLHeadingElement>(null);

  useEffect(() => { title.current?.focus(); }, []);
  useEffect(() => {
    if (saved) return;
    const preventLoss = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', preventLoss);
    return () => window.removeEventListener('beforeunload', preventLoss);
  }, [saved]);

  function download() {
    setDownloadError('');
    try {
      downloadBlob(new Blob([`FoundKeep recovery code\n\nAccount: ${email}\nRecovery code: ${code}\n\nKeep this file somewhere private. Anyone with this code and your email can reset your password. Using it replaces this code and disconnects your browsers. FoundKeep does not send password-reset emails.\n`], {type: 'text/plain'}), 'foundkeep-recovery-code.txt');
    } catch { setDownloadError('The download could not be started. Copy the recovery code somewhere private before continuing.'); }
  }

  return <div id="recovery-save">
    <div className="success-mark" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m5 12 4 4L19 6"/></svg></div>
    <h2 id="recovery-title" tabIndex={-1} ref={title}>Keep your way back in.</h2>
    <p className="muted">Save this recovery code somewhere private. This is the only time we’ll show it. You’ll need it if you forget your password; FoundKeep does not send reset emails.</p>
    <code className="recovery-display" id="new-recovery-code">{code}</code>
    <button className="button secondary wide" id="download-recovery" type="button" onClick={download}>Download recovery code <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4"/></svg></button>
    {downloadError ? <p className="form-message is-error" role="alert">{downloadError}</p> : null}
    <label className="check-field"><input id="recovery-saved" type="checkbox" checked={saved} onChange={event => setSaved(event.target.checked)}/><span>I saved my recovery code somewhere safe.</span></label>
    <button className="button primary wide" id="continue-dashboard" type="button" disabled={!saved} onClick={() => { if (saved) window.location.assign('/dashboard'); }}>Open my library <span aria-hidden="true">↗</span></button>
    <p className="field-help">Anyone with this code and your email can recover your account.</p>
  </div>;
}

export function AuthForm({mode: initialMode, deleted = false}: {mode: AuthMode; deleted?: boolean}) {
  const [mode, setMode] = useState(initialMode);
  const view = authViews[mode];
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [recoveryInput, setRecoveryInput] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const [error, setError] = useState('');
  const [providers, setProviders] = useState<OAuthProvider[] | null>(null);
  const [emailOpen, setEmailOpen] = useState(mode === 'recover');
  const [recovery, setRecovery] = useState<{code: string; email: string} | null>(null);
  const emailOnly = mode === 'recover' || providers?.length === 0;

  function changeMode(nextMode: AuthMode) {
    setMode(nextMode);
    setPassword('');
    setRecoveryInput('');
    setShowPassword(false);
    setError('');
  }

  function navigateMode(event: MouseEvent<HTMLAnchorElement>, nextMode: AuthMode) {
    if (busy) { event.preventDefault(); return; }
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    event.preventDefault();
    // Next supports native history updates. Keep the chosen email form and draft
    // identity while moving between the three independently server-guarded URLs.
    window.history.pushState(null, '', `/${nextMode}`);
    setEmailOpen(true);
    changeMode(nextMode);
  }

  useEffect(() => {
    function restoreMode() {
      if (recovery || busy) return;
      const requested = new URLSearchParams(window.location.search).get('mode');
      const route = window.location.pathname.slice(1);
      const value = route === 'auth' ? requested : route;
      changeMode(value === 'login' || value === 'recover' ? value : 'signup');
    }
    window.addEventListener('popstate', restoreMode);
    return () => window.removeEventListener('popstate', restoreMode);
  }, [recovery, busy]);

  useEffect(() => { document.title = `${authViews[mode].action} — FoundKeep`; }, [mode]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current || !event.currentTarget.reportValidity()) return;
    submitting.current = true;
    setBusy(true);
    setError('');
    try {
      const body = {email: email.trim(), password, ...(mode === 'signup' ? {name: name.trim()} : {}), ...(mode === 'recover' ? {recoveryCode: recoveryInput.trim()} : {})};
      const result = await api<{account: Account; recoveryCode?: string}>(`/auth/${mode === 'signup' ? 'register' : mode}`, {method: 'POST', body});
      setPassword('');
      setRecoveryInput('');
      if (mode === 'login') { window.location.assign('/dashboard'); return; }
      if (!result.recoveryCode) throw new Error('Your account was updated, but a recovery code was not returned. Log in and change your password to create one.');
      setRecovery({code: result.recoveryCode, email: result.account.email});
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Your account could not be updated. Please try again.');
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  if (recovery) return <section aria-labelledby="recovery-title"><RecoverySave code={recovery.code} email={recovery.email}/></section>;

  return <div id="auth-fields">
    <h2 id="auth-title">{view.title}</h2><p id="auth-description" className="muted">{view.description}</p>
    {mode !== 'recover' ? <OAuthButtons disabled={busy} onError={setError} onProviders={setProviders}/> : null}
    <p className="auth-identity-note" id="auth-identity-note" hidden={mode === 'recover' || !providers?.length}>Same verified email. Same collection.</p>
    <details className={`email-signin${emailOnly ? ' email-only' : ''}`} id="email-signin" open={emailOnly || emailOpen} onToggle={event => { if (!emailOnly) setEmailOpen(event.currentTarget.open); }}>
      <summary>Continue with email<svg aria-hidden="true" viewBox="0 0 24 24"><path d="m7 10 5 5 5-5"/></svg></summary>
      <nav className="auth-tabs" aria-label="Account options">
        <Link href="/signup" prefetch={false} data-mode="signup" aria-current={mode === 'signup' ? 'page' : undefined} aria-disabled={busy || undefined} onClick={event => navigateMode(event, 'signup')}>Create account</Link>
        <Link href="/login" prefetch={false} data-mode="login" aria-current={mode === 'login' ? 'page' : undefined} aria-disabled={busy || undefined} onClick={event => navigateMode(event, 'login')}>Log in</Link>
      </nav>
      <form id="auth-form" onSubmit={event => void submit(event)} aria-busy={busy}>
        <div className="field" id="name-field" hidden={mode !== 'signup'}><label htmlFor="name">Your name</label><input id="name" name="name" autoComplete="name" maxLength={100} required={mode === 'signup'} disabled={busy || mode !== 'signup'} value={name} onChange={event => setName(event.target.value)}/></div>
        <div className="field"><label htmlFor="email">Email address</label><input id="email" name="email" type="email" autoComplete="email" autoCapitalize="none" maxLength={254} required disabled={busy} value={email} onChange={event => setEmail(event.target.value)}/></div>
        <div className="field" id="recovery-field" hidden={mode !== 'recover'}><label htmlFor="recovery-code">Recovery code</label><input id="recovery-code" name="recoveryCode" autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={200} required={mode === 'recover'} disabled={busy || mode !== 'recover'} value={recoveryInput} onChange={event => setRecoveryInput(event.target.value)} aria-describedby="recovery-help"/><p className="field-help" id="recovery-help">Use the code you saved when you created your account or last changed your password.</p></div>
        <div className="field"><label htmlFor="password" id="password-label">{mode === 'recover' ? 'New password' : 'Password'}</label><div className="password-input"><input id="password" name="password" type={showPassword ? 'text' : 'password'} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} minLength={mode === 'login' ? 1 : 12} maxLength={128} required disabled={busy} value={password} onChange={event => setPassword(event.target.value)} aria-describedby={mode === 'login' ? undefined : 'password-help'}/><button className="password-toggle" id="show-password" type="button" aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword} onClick={() => setShowPassword(value => !value)}>{showPassword ? 'Hide' : 'Show'}</button></div><p className="field-help" id="password-help" hidden={mode === 'login'}>Use 12–128 characters. A password manager is a good place to keep it.</p></div>
        <button className="button primary wide" id="auth-submit" type="submit" disabled={busy}>{busy ? 'Please wait…' : view.action} {!busy ? <span aria-hidden="true">↗</span> : null}</button>
      </form>
      <p className="auth-recover" hidden={mode === 'recover'}><Link href="/recover" prefetch={false} data-mode="recover" aria-disabled={busy || undefined} onClick={event => navigateMode(event, 'recover')}>Recover your account</Link></p>
    </details>
    <p className={`form-message${error ? ' is-error' : ''}`} id="auth-error" role={error ? 'alert' : 'status'} hidden={!error && !deleted}>{error || (deleted ? 'Your account and cloud library were deleted.' : '')}</p>
    <p className="auth-terms" id="auth-terms" hidden={mode === 'recover'}>By continuing, you accept our <Link href="/terms">Terms</Link> and <Link href="/privacy">Privacy</Link>.</p>
  </div>;
}
