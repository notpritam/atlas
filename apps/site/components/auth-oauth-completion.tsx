'use client';

import Link from 'next/link';
import {useCallback, useEffect, useRef, useState} from 'react';
import {api, ApiError} from '@/lib/api';
import {clearOAuthHandoff, readOAuthHandoff, type OAuthHandoff} from '@/lib/oauth';
import type {Account} from '@/lib/types';

type CompletionStage = 'working' | 'link' | 'retry' | 'delete' | 'failed';

export function OAuthCompletion() {
  const [stage, setStage] = useState<CompletionStage>('working');
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState('Finishing your sign-in…');
  const [isError, setIsError] = useState(false);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const passwordInput = useRef<HTMLInputElement>(null);
  const handoff = useRef<OAuthHandoff | null>(null);
  const deletionProof = useRef('');
  const working = useRef(false);
  const initialized = useRef(false);
  const mounted = useRef(false);

  const exchange = useCallback(async (existingPassword = '') => {
    const current = handoff.current;
    if (!current || working.current) return;
    working.current = true;
    setBusy(true);
    setMessage('Finishing your sign-in…');
    setIsError(false);
    try {
      const result = await api<{account?: Account; reauthToken?: string}>('/auth/oauth/exchange', {
        method: 'POST', accountId: current.accountId,
        body: {flow: current.flow, code: current.code, verifier: current.verifier, ...(existingPassword ? {password: existingPassword} : {})},
      });
      clearOAuthHandoff(current.flow);
      if (!mounted.current) return;
      setPassword('');
      if (current.intent === 'delete' && result.reauthToken && /^[A-Za-z0-9_-]{43}$/.test(result.reauthToken)) {
        deletionProof.current = result.reauthToken;
        setStage('delete');
        setMessage('Identity verified. Permanently delete your account, cloud collection, and connections? This cannot be undone.');
      } else if (current.intent === 'sign-in' && result.account) {
        window.location.replace('/dashboard');
      } else {
        throw new Error('Sign-in could not be completed. Start again.');
      }
    } catch (error) {
      if (!mounted.current) return;
      setMessage(error instanceof Error ? error.message : 'Sign-in could not be completed. Start again.');
      setIsError(true);
      if (error instanceof ApiError && ['account_link_required', 'invalid_credentials'].includes(error.code)) {
        setStage('link');
      } else if (error instanceof ApiError && (error.status === 0 || error.status === 429 || error.status >= 500)) {
        setStage('retry');
      } else {
        clearOAuthHandoff(current.flow);
        handoff.current = null;
        setStage('failed');
      }
    } finally {
      working.current = false;
      if (mounted.current) setBusy(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    if (!initialized.current) {
      initialized.current = true;
      const params = new URLSearchParams(window.location.search);
      // Remove the one-time handoff from history before any account interaction.
      window.history.replaceState(window.history.state, '', '/auth');
      handoff.current = readOAuthHandoff(params);
      if (handoff.current) void exchange();
      else {
        setStage('failed');
        setBusy(false);
        setMessage('Sign-in was canceled or expired. Please start again.');
        setIsError(true);
      }
    }
    return () => { mounted.current = false; };
  }, [exchange]);

  useEffect(() => { if (stage === 'link' && !busy) passwordInput.current?.focus(); }, [stage, busy]);

  async function deleteAccount() {
    if (working.current || !deletionProof.current) return;
    working.current = true;
    setBusy(true);
    setIsError(false);
    setMessage('Deleting your account…');
    try {
      await api('/account', {method: 'DELETE', accountId: handoff.current?.accountId, body: {reauthToken: deletionProof.current}});
      deletionProof.current = '';
      if (mounted.current) window.location.replace('/signup?deleted=1');
    } catch (error) {
      if (!mounted.current) return;
      setMessage(error instanceof Error ? error.message : 'Your account could not be deleted. Please try again.');
      setIsError(true);
      if (error instanceof ApiError && (error.status === 401 || error.code === 'account_changed')) {
        deletionProof.current = '';
        setStage('failed');
      }
    } finally {
      working.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  return <section id="oauth-completion" aria-labelledby="oauth-title" aria-busy={busy}>
    <h2 id="oauth-title">Your FoundKeep account.</h2>
    <p id="oauth-message" className={`form-message${isError ? ' is-error' : ''}`} role={isError ? 'alert' : 'status'}>{message}</p>
    <form id="oauth-link-fields" hidden={stage !== 'link'} onSubmit={event => { event.preventDefault(); if (event.currentTarget.reportValidity()) void exchange(password); }}>
      <div className="field"><label htmlFor="oauth-password">Existing FoundKeep password</label><div className="password-input"><input id="oauth-password" ref={passwordInput} name="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" maxLength={128} required disabled={busy || stage !== 'link'} value={password} onChange={event => setPassword(event.target.value)}/><button className="password-toggle" type="button" aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword} onClick={() => setShowPassword(value => !value)}>{showPassword ? 'Hide' : 'Show'}</button></div></div>
      <button id="oauth-connect" className="button primary wide" type="submit" disabled={busy}>{busy ? 'Connecting…' : 'Connect to my existing collection'}</button>
    </form>
    {stage === 'retry' ? <button id="oauth-retry" className="button primary wide" type="button" disabled={busy} onClick={() => void exchange(password)}>{busy ? 'Trying again…' : 'Try again'}</button> : null}
    <button id="oauth-delete" className="button primary wide" type="button" hidden={stage !== 'delete'} disabled={busy} onClick={() => void deleteAccount()}>{busy ? 'Deleting account…' : 'Delete account permanently'}</button>
    <p className="oauth-completion-links"><Link href="/login" prefetch={false}>Back to sign in</Link> · <Link href="/dashboard" prefetch={false}>Keep my account</Link></p>
  </section>;
}
