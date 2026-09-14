import { mountOAuthButtons, completeOAuth } from './oauth.js?v=20260910-scenic-auth';
import { $, api, setMessage, recoveryDownload } from './customer.js?v=1.5.0';

let mode = 'signup';
let recoveryCode = '';
let accountEmail = '';
let busy = false;
let providersReady = false;
function updateSignInOptions() {
  const hasProviders = $('#oauth-buttons').children.length > 0;
  $('#oauth-buttons').hidden = mode === 'recover' || !hasProviders;
  $('#oauth-loading').hidden = providersReady || mode === 'recover';
  $('#auth-identity-note').hidden = mode === 'recover' || !hasProviders;
  $('#email-signin').classList.toggle('email-only', mode === 'recover' || (providersReady && !hasProviders));
  if (mode === 'recover' || (providersReady && !hasProviders)) $('#email-signin').open = true;
}
const views = {
  signup: ['Keep the good things.', 'Sign in or create an account. Your collection comes with you.', 'Create account'],
  login: ['Welcome back.', 'Your good finds are right where you left them.', 'Log in'],
  recover: ['A way back in.', 'Use your saved recovery code to choose a new password. This disconnects your browsers and signs out your other sessions.', 'Recover account'],
};
function setMode(value) {
  mode = Object.hasOwn(views, value) ? value : 'signup';
  const [title, description, action] = views[mode];
  document.title = `${action} — FoundKeep`;
  $('#auth-title').textContent = title; $('#auth-description').textContent = description;
  $('#auth-submit').textContent = action;
  $('#name-field').hidden = mode !== 'signup'; $('#name').required = mode === 'signup'; $('#name').disabled = mode !== 'signup';
  $('#recovery-field').hidden = mode !== 'recover'; $('#recovery-code').required = mode === 'recover'; $('#recovery-code').disabled = mode !== 'recover';
  $('#password').autocomplete = mode === 'login' ? 'current-password' : 'new-password';
  $('#password').minLength = mode === 'login' ? 1 : 12;
  $('#password-label').textContent = mode === 'recover' ? 'New password' : 'Password';
  $('#password-help').hidden = mode === 'login';
  $('#auth-terms').hidden = mode === 'recover';
  $('.auth-recover').hidden = mode === 'recover';
  updateSignInOptions();
  document.querySelectorAll('[data-mode]').forEach(link => {
    if (link.dataset.mode === mode) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
  });
  setMessage($('#auth-error'), '');
}
document.querySelectorAll('[data-mode]').forEach(link => link.addEventListener('click', event => {
  if (busy) { event.preventDefault(); return; }
  event.preventDefault();
  history.pushState(null, '', `?mode=${link.dataset.mode}`);
  $('#password').value = ''; $('#recovery-code').value = '';
  setMode(link.dataset.mode);
}));
const modeFromURL = () => new URLSearchParams(location.search).get('mode') || (location.pathname === '/login' ? 'login' : 'signup');
window.addEventListener('popstate', () => { if (!recoveryCode && !busy) setMode(modeFromURL()); });
setMode(modeFromURL());
if (new URLSearchParams(location.search).get('deleted') === '1') setMessage($('#auth-error'), 'Your account and cloud library were deleted.', false);
$('#show-password').addEventListener('click', () => {
  const show = $('#password').type === 'password';
  $('#password').type = show ? 'text' : 'password';
  $('#show-password').textContent = show ? 'Hide' : 'Show';
  $('#show-password').setAttribute('aria-label', show ? 'Hide password' : 'Show password');
  $('#show-password').setAttribute('aria-pressed', String(show));
});
$('#auth-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (busy || !event.currentTarget.reportValidity()) return;
  busy = true; $('#auth-submit').disabled = true; $('#auth-submit').textContent = 'Please wait…';
  setMessage($('#auth-error'), '');
  try {
    const body = { email: $('#email').value.trim(), password: $('#password').value };
    if (mode === 'signup') body.name = $('#name').value.trim();
    if (mode === 'recover') body.recoveryCode = $('#recovery-code').value.trim();
    const result = await api(`/auth/${mode === 'signup' ? 'register' : mode}`, { method: 'POST', body });
    $('#password').value = ''; $('#recovery-code').value = '';
    if (mode === 'login') { location.assign('/dashboard.html'); return; }
    if (!result.recoveryCode) throw new Error('Your account was updated, but a recovery code was not returned. Log in and change your password to create one.');
    recoveryCode = result.recoveryCode; accountEmail = result.account.email;
    $('#new-recovery-code').textContent = recoveryCode;
    $('#auth-fields').hidden = true; $('#recovery-save').hidden = false;
    $('#recovery-title').focus();
  } catch (error) { setMessage($('#auth-error'), error.message); }
  finally { busy = false; $('#auth-submit').disabled = false; $('#auth-submit').textContent = views[mode][2]; }
});
$('#download-recovery').addEventListener('click', () => recoveryDownload(recoveryCode, accountEmail));
$('#recovery-saved').addEventListener('change', event => { $('#continue-dashboard').disabled = !event.target.checked; });
$('#continue-dashboard').addEventListener('click', () => {
  if (!$('#recovery-saved').checked) return;
  recoveryCode = ''; $('#new-recovery-code').textContent = '';
  location.assign('/dashboard.html');
});
window.addEventListener('beforeunload', event => { if (recoveryCode && !$('#recovery-saved').checked) event.preventDefault(); });

if (!completeOAuth()) void mountOAuthButtons($('#oauth-buttons'), $('#auth-error')).finally(() => { providersReady = true; updateSignInOptions(); });
