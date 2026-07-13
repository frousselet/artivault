import './style.css';
import { apiGet, apiPost } from './api.js';
import { loginPasskey, registerPasskey, type SessionUser } from './auth.js';

interface SessionResponse {
  authenticated: boolean;
  user?: SessionUser;
}

const app = document.querySelector<HTMLDivElement>('#app');

function byId<T extends HTMLElement = HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch] ?? ch);
}

function view(inner: string): void {
  if (app) app.innerHTML = `<main class="wrap">${inner}</main>`;
}

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

function signedInView(user: SessionUser): void {
  view(`
    <h1>Artivault</h1>
    <p class="tag">Signed in</p>
    <section class="status ok">
      ${escapeHtml(user.displayName)} — ${escapeHtml(user.email)}
      <span class="role">${escapeHtml(user.role)}</span>
    </section>
    <div class="row">
      <button id="add-device" class="btn ghost" type="button">Add a passkey to this device</button>
      <button id="logout" class="btn" type="button">Sign out</button>
    </div>
    <p id="msg" class="hint"></p>
    <p class="hint">Dashboard, editor, sharing and admin views (spec §13) come next.</p>
  `);
  byId('add-device')?.addEventListener('click', () => runFlow(() => registerPasskey(user.email)));
  byId('logout')?.addEventListener('click', async () => {
    await apiPost('/api/auth/logout', {});
    await boot();
  });
}

function signedOutView(): void {
  view(`
    <h1>Artivault</h1>
    <p class="tag">Self-hosted vault for AI-generated artifacts</p>
    <form id="auth-form" class="auth">
      <label class="field">Email
        <input id="email" type="email" autocomplete="username webauthn"
               placeholder="you@example.com" required />
      </label>
      <div class="row">
        <button id="login" class="btn" type="submit">Sign in with a passkey</button>
        <button id="register" class="btn ghost" type="button">Register a passkey</button>
      </div>
    </form>
    <p id="msg" class="hint"></p>
  `);
  const email = () => byId<HTMLInputElement>('email')?.value.trim() ?? '';
  byId('auth-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    if (email()) runFlow(() => loginPasskey(email()));
    else message('Enter your email first.', true);
  });
  byId('register')?.addEventListener('click', () => {
    if (email()) runFlow(() => registerPasskey(email()));
    else message('Enter an email to register.', true);
  });
}

async function boot(): Promise<void> {
  let session: SessionResponse;
  try {
    session = await apiGet<SessionResponse>('/api/auth/session');
  } catch {
    session = { authenticated: false };
  }
  if (session.authenticated && session.user) signedInView(session.user);
  else signedOutView();
}

void boot();
