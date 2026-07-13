import './style.css';
import { apiGet, apiPost } from './api.js';
import { renderApp } from './app.js';
import {
  fetchInvite,
  loginPasskey,
  registerPasskey,
  registerWithInvite,
  type SessionUser,
} from './auth.js';
import { byId } from './dom.js';
import { icon } from './icons.js';

interface SessionResponse {
  authenticated: boolean;
  user?: SessionUser;
}

const app = document.querySelector<HTMLDivElement>('#app');

function message(text: string, isError = false): void {
  const el = byId('msg');
  if (!el) return;
  el.textContent = text;
  el.classList.toggle('err', isError);
  el.classList.toggle('ok', !isError && text !== '');
}

async function runFlow(fn: () => Promise<SessionUser>): Promise<void> {
  message('Waiting for your passkey…');
  try {
    await fn();
    await boot();
  } catch (err) {
    message((err as Error).message || 'Something went wrong.', true);
  }
}

function signedOutView(): void {
  if (!app) return;
  app.innerHTML = `
    <div class="auth-screen">
      <div class="brand brand--lg">${icon('brand', 'brand-mark')}<span>Artivault</span></div>
      <div class="auth-card">
        <h1>Welcome back</h1>
        <p class="tag">Sign in to your vault with a passkey.</p>
        <form id="auth-form" class="auth">
          <label class="field">Email
            <input id="email" type="email" autocomplete="username webauthn"
                   placeholder="you@example.com" required />
          </label>
          <button id="login" class="btn block" type="submit">Sign in with a passkey</button>
          <button id="register" class="btn ghost block" type="button">Register a passkey</button>
        </form>
        <p id="msg" class="hint"></p>
      </div>
    </div>`;
  const email = () => byId<HTMLInputElement>('email')?.value.trim() ?? '';
  byId('auth-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    if (email()) void runFlow(() => loginPasskey(email()));
    else message('Enter your email first.', true);
  });
  byId('register')?.addEventListener('click', () => {
    if (email()) void runFlow(() => registerPasskey(email()));
    else message('Enter an email to register.', true);
  });
}

function parseInviteToken(): string | null {
  const m = location.pathname.match(/^\/invite\/([^/]+)\/?$/);
  if (m?.[1]) return decodeURIComponent(m[1]);
  return new URLSearchParams(location.search).get('invite');
}

async function inviteView(token: string): Promise<void> {
  if (!app) return;
  app.innerHTML = `
    <div class="auth-screen">
      <div class="brand brand--lg">${icon('brand', 'brand-mark')}<span>Artivault</span></div>
      <div class="auth-card">
        <h1>You're invited</h1>
        <p id="who" class="tag">Checking your invitation…</p>
        <button id="accept" class="btn block" type="button" disabled>Create your passkey</button>
        <p id="msg" class="hint"></p>
        <p class="hint"><a id="to-signin" href="#">Already have a passkey? Sign in</a></p>
      </div>
    </div>`;
  byId('to-signin')?.addEventListener('click', (e) => {
    e.preventDefault();
    history.replaceState(null, '', '/');
    signedOutView();
  });

  const who = byId('who');
  const accept = byId<HTMLButtonElement>('accept');
  try {
    const info = await fetchInvite(token);
    if (who) who.textContent = `Set up your passkey for ${info.email}.`;
    if (accept) accept.disabled = false;
  } catch (err) {
    if (who) who.textContent = 'This invitation is invalid or has expired.';
    message((err as Error).message, true);
  }

  accept?.addEventListener('click', () => {
    message('Waiting for your passkey…');
    registerWithInvite(token)
      .then(() => {
        history.replaceState(null, '', '/');
        return boot();
      })
      .catch((err: unknown) => message((err as Error).message, true));
  });
}

async function boot(): Promise<void> {
  const inviteToken = parseInviteToken();
  if (inviteToken) {
    await inviteView(inviteToken);
    return;
  }

  let session: SessionResponse;
  try {
    session = await apiGet<SessionResponse>('/api/auth/session');
  } catch {
    session = { authenticated: false };
  }
  if (session.authenticated && session.user && app) {
    renderApp({
      container: app,
      user: session.user,
      onSignOut: async () => {
        await apiPost('/api/auth/logout', {});
        await boot();
      },
    });
  } else {
    signedOutView();
  }
}

void boot();
