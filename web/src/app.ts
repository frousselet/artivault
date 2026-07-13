import { deletePasskey, listPasskeys, type Passkey } from './account.js';
import {
  type AdminUser,
  createUser as adminCreateUser,
  updateUser as adminUpdateUser,
  generateInvite,
  type Invite,
  listUsers,
} from './admin.js';
import {
  type Access,
  type Artifact,
  type ArtifactKind,
  type ArtifactSummary,
  createArtifact,
  deleteArtifact,
  getArtifact,
  listArtifacts,
  listShares,
  previewArtifact,
  type Share,
  setVisibility,
  shareArtifact,
  unshareArtifact,
  updateArtifact,
  type Visibility,
} from './artifacts.js';
import { registerPasskey, type SessionUser } from './auth.js';
import { byId, debounce, escapeHtml } from './dom.js';
import { icon } from './icons.js';
import { searchUsers, type UserHit } from './users.js';

const KINDS: ArtifactKind[] = ['html', 'svg', 'markdown'];

export interface AppHost {
  container: HTMLElement;
  user: SessionUser;
  onSignOut: () => void | Promise<void>;
}

type ViewName = 'artifacts' | 'account' | 'admin';

let host: AppHost;
let viewEl: HTMLElement;

/** Entry point for the signed-in application: build the shell, then route. */
export function renderApp(h: AppHost): void {
  host = h;
  h.container.innerHTML = shellHtml();
  const slot = byId('view');
  if (!slot) return;
  viewEl = slot;
  wireShell();
  navigate('artifacts');
}

function shellHtml(): string {
  const u = host.user;
  const adminNav =
    u.role === 'admin'
      ? `<button class="nav-item" data-view="admin" type="button">${icon('admin')}<span>Users</span></button>`
      : '';
  return `<div class="shell">
    <header class="app-header">
      <button class="icon-btn nav-toggle" id="nav-toggle" type="button" aria-label="Toggle menu">${icon('menu')}</button>
      <div class="brand">${icon('brand', 'brand-mark')}<span>Artivault</span></div>
      <div class="header-spacer"></div>
      <div class="user-chip">
        <span class="user-email">${escapeHtml(u.email)}</span>
        <span class="badge badge--${u.role}">${escapeHtml(u.role)}</span>
      </div>
      <button class="btn ghost sm" id="signout" type="button">Sign out</button>
    </header>
    <div class="app-body">
      <nav class="sidebar" id="sidebar">
        <button class="nav-item" data-view="artifacts" type="button">${icon('artifacts')}<span>Artifacts</span></button>
        <button class="nav-item" data-view="account" type="button">${icon('account')}<span>Account</span></button>
        ${adminNav}
      </nav>
      <main class="app-main" id="view"></main>
    </div>
    <div class="scrim" id="scrim"></div>
  </div>`;
}

function wireShell(): void {
  byId('signout')?.addEventListener('click', () => void host.onSignOut());
  byId('nav-toggle')?.addEventListener('click', toggleNav);
  byId('scrim')?.addEventListener('click', closeNav);
  for (const item of document.querySelectorAll<HTMLElement>('.nav-item')) {
    item.addEventListener('click', () => navigate(item.dataset.view as ViewName));
  }
}

function setActiveNav(view: ViewName): void {
  for (const item of document.querySelectorAll<HTMLElement>('.nav-item')) {
    item.classList.toggle('active', item.dataset.view === view);
  }
}

const toggleNav = (): void => {
  byId('sidebar')?.classList.toggle('open');
  byId('scrim')?.classList.toggle('open');
};
const closeNav = (): void => {
  byId('sidebar')?.classList.remove('open');
  byId('scrim')?.classList.remove('open');
};

function navigate(view: ViewName): void {
  setActiveNav(view);
  closeNav();
  if (view === 'account') void showAccount();
  else if (view === 'admin') void showAdmin();
  else void showDashboard();
}

// --- shared bits ---

function emptyState(title: string, detail: string): string {
  return `<div class="empty"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(detail)}</span></div>`;
}
function errorState(message: string): string {
  return `<div class="empty error"><strong>Something went wrong</strong><span>${escapeHtml(message)}</span></div>`;
}

// --- Artifacts: dashboard ---

async function showDashboard(): Promise<void> {
  viewEl.innerHTML = `
    <div class="view-head">
      <h2>Artifacts</h2>
      <button id="new" class="btn" type="button">${icon('plus')} New artifact</button>
    </div>
    <section id="list" class="grid"><p class="muted">Loading…</p></section>`;
  byId('new')?.addEventListener('click', () => void showEditor(null));

  const listEl = byId('list');
  try {
    const artifacts = await listArtifacts();
    if (!listEl) return;
    if (artifacts.length === 0) {
      listEl.innerHTML = emptyState(
        'No artifacts yet',
        'Create your first artifact to see it here.',
      );
      return;
    }
    listEl.innerHTML = artifacts.map(cardHtml).join('');
    for (const a of artifacts) {
      byId(`edit-${a.id}`)?.addEventListener('click', () => void showEditor(a.id));
      byId(`open-${a.id}`)?.addEventListener('click', () =>
        window.open(a.url, '_blank', 'noopener'),
      );
    }
  } catch (err) {
    if (listEl) listEl.innerHTML = errorState((err as Error).message);
  }
}

function cardHtml(a: ArtifactSummary): string {
  const shareBadge =
    a.access && a.access !== 'owner'
      ? `<span class="badge badge--${a.access === 'write' ? 'active' : 'muted'}">shared: ${a.access}</span>`
      : a.shareCount && a.shareCount > 0
        ? `<span class="badge badge--muted">shared · ${a.shareCount}</span>`
        : '';
  return `<article class="card">
    <div class="card-body">
      <div class="card-title">${escapeHtml(a.name)}</div>
      <div class="badges">
        <span class="badge badge--${a.kind}">${a.kind}</span>
        <span class="badge badge--${a.visibility}">${a.visibility}</span>
        <span class="badge badge--muted">v${a.currentVersion}</span>
        ${shareBadge}
      </div>
    </div>
    <div class="card-actions">
      <button id="edit-${a.id}" class="btn ghost sm" type="button">${a.access === 'read' ? 'View' : 'Edit'}</button>
      <button id="open-${a.id}" class="btn ghost sm" type="button">Open ↗</button>
    </div>
  </article>`;
}

// --- Artifacts: editor ---

interface EditorState {
  id: string | null;
  slug: string | null;
  name: string;
  kind: ArtifactKind;
  content: string;
  currentVersion: number;
  visibility: Visibility;
  access: Access;
}

const blankState = (): EditorState => ({
  id: null,
  slug: null,
  name: '',
  kind: 'html',
  content: '',
  currentVersion: 0,
  visibility: 'private',
  access: 'owner',
});

const stateOf = (a: Artifact): EditorState => ({
  id: a.id,
  slug: a.slug,
  name: a.name,
  kind: a.kind,
  content: a.content,
  currentVersion: a.currentVersion,
  visibility: a.visibility,
  access: a.access ?? 'owner',
});

async function showEditor(id: string | null): Promise<void> {
  setActiveNav('artifacts');
  let state: EditorState;
  try {
    state = id ? stateOf(await getArtifact(id)) : blankState();
  } catch (err) {
    viewEl.innerHTML = errorState((err as Error).message);
    return;
  }

  const saved = state.id !== null;
  const owner = state.access === 'owner';
  const canWrite = owner || state.access === 'write';
  const accessNote = owner
    ? ''
    : `<span class="badge badge--${state.access === 'write' ? 'active' : 'private'}">${
        state.access === 'write' ? 'shared: write' : 'read-only'
      }</span>`;
  viewEl.innerHTML = `
    <div class="view-head">
      <div class="row">
        <button id="back" class="btn ghost sm" type="button">← Artifacts</button>
        <span id="ver" class="badge badge--muted">${saved ? `v${state.currentVersion}` : 'draft'}</span>
        ${accessNote}
      </div>
      <div class="row">
        ${owner ? `<button id="share" class="btn ghost sm" type="button"${saved ? '' : ' disabled'}>Share</button>` : ''}
        ${owner ? `<button id="visibility" class="btn ghost sm" type="button"${saved ? '' : ' disabled'}></button>` : ''}
        <button id="open" class="btn ghost sm" type="button"${saved ? '' : ' disabled'}>Open ↗</button>
        ${owner ? `<button id="delete" class="btn danger sm" type="button"${saved ? '' : ' disabled'}>Delete</button>` : ''}
        ${canWrite ? '<button id="save" class="btn" type="button">Save</button>' : ''}
      </div>
    </div>
    <div class="editor-grid">
      <div class="pane">
        <div class="field-row">
          <input id="name" class="input" placeholder="Artifact name" />
          <select id="kind" class="input kind-select">
            ${KINDS.map((k) => `<option value="${k}">${k}</option>`).join('')}
          </select>
        </div>
        <textarea id="source" class="source" spellcheck="false" placeholder="Write your HTML, SVG or Markdown…"></textarea>
        <p id="status" class="hint"></p>
      </div>
      <iframe id="preview" class="preview" sandbox="allow-scripts" title="Preview"></iframe>
    </div>`;

  const nameEl = byId<HTMLInputElement>('name');
  const kindEl = byId<HTMLSelectElement>('kind');
  const sourceEl = byId<HTMLTextAreaElement>('source');
  const preview = byId<HTMLIFrameElement>('preview');
  if (!nameEl || !kindEl || !sourceEl || !preview) return;
  nameEl.value = state.name;
  kindEl.value = state.kind;
  sourceEl.value = state.content;
  if (!canWrite) {
    nameEl.disabled = true;
    kindEl.disabled = true;
    sourceEl.readOnly = true;
  }

  const status = (msg: string, isError = false): void => {
    const s = byId('status');
    if (s) {
      s.textContent = msg;
      s.classList.toggle('err', isError);
    }
  };
  const syncVisibilityButton = (): void => {
    const b = byId('visibility');
    if (b) b.textContent = state.visibility === 'public' ? 'Make private' : 'Make public';
  };
  syncVisibilityButton();

  byId('share')?.addEventListener('click', () => {
    if (state.id) void showShareModal(state.id, state.name);
  });

  const refreshPreview = debounce(() => {
    previewArtifact(kindEl.value as ArtifactKind, sourceEl.value)
      .then((html) => {
        preview.srcdoc = html;
      })
      .catch(() => {
        /* ignore preview errors while typing */
      });
  }, 350);
  refreshPreview();
  sourceEl.addEventListener('input', refreshPreview);
  kindEl.addEventListener('change', refreshPreview);

  byId('back')?.addEventListener('click', () => void showDashboard());

  byId('save')?.addEventListener('click', async () => {
    status('Saving…');
    try {
      if (!state.id) {
        const created = await createArtifact({
          name: nameEl.value.trim() || 'Untitled',
          kind: kindEl.value as ArtifactKind,
          content: sourceEl.value,
        });
        await showEditor(created.id); // reopen in edit mode
        return;
      }
      const updated = await updateArtifact(state.id, {
        baseVersion: state.currentVersion,
        content: sourceEl.value,
        name: nameEl.value.trim() || undefined,
        kind: kindEl.value as ArtifactKind,
      });
      state = stateOf(updated);
      const ver = byId('ver');
      if (ver) ver.textContent = `v${updated.currentVersion}`;
      status(`Saved — v${updated.currentVersion}`);
    } catch (err) {
      status((err as Error).message, true);
    }
  });

  byId('open')?.addEventListener('click', () => {
    if (state.slug) window.open(`/artifact/${state.slug}`, '_blank', 'noopener');
  });

  byId('visibility')?.addEventListener('click', async () => {
    if (!state.id) return;
    const next: Visibility = state.visibility === 'public' ? 'private' : 'public';
    if (
      next === 'public' &&
      !window.confirm('Make public? Anyone with the link can view it without signing in.')
    ) {
      return;
    }
    try {
      const updated = await setVisibility(state.id, next);
      state = stateOf({ ...updated, content: sourceEl.value });
      syncVisibilityButton();
      status(`Now ${updated.visibility}`);
    } catch (err) {
      status((err as Error).message, true);
    }
  });

  byId('delete')?.addEventListener('click', async () => {
    if (!state.id) return;
    if (!window.confirm('Delete this artifact? This cannot be undone.')) return;
    try {
      await deleteArtifact(state.id);
      void showDashboard();
    } catch (err) {
      status((err as Error).message, true);
    }
  });
}

// --- Sharing (spec §8) ---

function openModal(title: string, bodyHtml: string): void {
  const root = document.createElement('div');
  root.className = 'modal-scrim';
  root.innerHTML = `<div class="modal" role="dialog" aria-modal="true">
    <div class="modal-head">
      <h3>${escapeHtml(title)}</h3>
      <button class="icon-btn" data-close type="button" aria-label="Close">✕</button>
    </div>
    <div class="modal-body">${bodyHtml}</div>
  </div>`;
  document.body.appendChild(root);
  const close = (): void => root.remove();
  root.addEventListener('click', (e) => {
    if (e.target === root) close();
  });
  root.querySelector<HTMLElement>('[data-close]')?.addEventListener('click', close);
}

async function showShareModal(artifactId: string, name: string): Promise<void> {
  openModal(
    `Share “${name}”`,
    `<form id="share-form" class="share-form">
      <div class="combo">
        <input id="share-query" class="input" type="text" autocomplete="off"
               placeholder="Search a user by name or email" />
        <div id="share-suggest" class="suggest" hidden></div>
      </div>
      <select id="share-perm" class="input perm-select">
        <option value="read">read</option>
        <option value="write">write</option>
      </select>
      <button class="btn" type="submit">Share</button>
    </form>
    <p id="share-msg" class="hint"></p>
    <div id="share-list" class="share-list"><p class="muted">Loading…</p></div>`,
  );

  const smsg = (text: string, isError = false): void => {
    const m = byId('share-msg');
    if (m) {
      m.textContent = text;
      m.classList.toggle('err', isError);
    }
  };

  const render = (shares: Share[]): void => {
    const list = byId('share-list');
    if (!list) return;
    list.innerHTML =
      shares.length === 0
        ? '<p class="muted">Not shared with anyone yet.</p>'
        : shares.map(shareRow).join('');
    for (const s of shares) {
      byId<HTMLSelectElement>(`perm-${s.granteeId}`)?.addEventListener('change', (ev) => {
        const perm = (ev.target as HTMLSelectElement).value as 'read' | 'write';
        shareArtifact(artifactId, s.email, perm)
          .then(render)
          .catch((err: unknown) => smsg((err as Error).message, true));
      });
      byId(`unshare-${s.granteeId}`)?.addEventListener('click', () => {
        unshareArtifact(artifactId, s.granteeId)
          .then(render)
          .catch((err: unknown) => smsg((err as Error).message, true));
      });
    }
  };

  // --- user autocomplete ---
  const queryEl = byId<HTMLInputElement>('share-query');
  const suggestEl = byId('share-suggest');
  let selected: UserHit | null = null;

  const hideSuggest = (): void => {
    if (suggestEl) suggestEl.hidden = true;
  };
  const pick = (hit: UserHit): void => {
    selected = hit;
    if (queryEl) queryEl.value = `${hit.displayName} · ${hit.email}`;
    hideSuggest();
  };
  const renderSuggest = (hits: UserHit[]): void => {
    if (!suggestEl) return;
    if (hits.length === 0) {
      suggestEl.innerHTML = '<div class="suggest-empty">No matching users</div>';
      suggestEl.hidden = false;
      return;
    }
    suggestEl.innerHTML = hits
      .map(
        (h, i) =>
          `<button type="button" class="suggest-item" data-i="${i}"><strong>${escapeHtml(
            h.displayName,
          )}</strong><span class="muted sm">${escapeHtml(h.email)}</span></button>`,
      )
      .join('');
    suggestEl.hidden = false;
    for (const [i, h] of hits.entries()) {
      suggestEl
        .querySelector<HTMLElement>(`[data-i="${i}"]`)
        ?.addEventListener('click', () => pick(h));
    }
  };

  const runSearch = debounce(() => {
    selected = null;
    const q = queryEl?.value.trim() ?? '';
    if (q.length < 1) {
      hideSuggest();
      return;
    }
    searchUsers(q)
      .then(renderSuggest)
      .catch(() => hideSuggest());
  }, 200);
  queryEl?.addEventListener('input', runSearch);
  queryEl?.addEventListener('blur', () => setTimeout(hideSuggest, 150));

  byId('share-form')?.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const perm = (byId<HTMLSelectElement>('share-perm')?.value ?? 'read') as 'read' | 'write';
    const email = selected?.email ?? queryEl?.value.trim() ?? '';
    if (!email) {
      smsg('Pick a user to share with.', true);
      return;
    }
    shareArtifact(artifactId, email, perm)
      .then((shares) => {
        render(shares);
        selected = null;
        if (queryEl) queryEl.value = '';
        hideSuggest();
        smsg('Shared.');
      })
      .catch((err: unknown) => smsg((err as Error).message, true));
  });

  try {
    render(await listShares(artifactId));
  } catch (err) {
    smsg((err as Error).message, true);
  }
}

function shareRow(s: Share): string {
  return `<div class="share-row">
    <div class="share-who">
      <strong>${escapeHtml(s.email)}</strong>
      <span class="muted sm">${escapeHtml(s.displayName)}</span>
    </div>
    <div class="row">
      <select id="perm-${s.granteeId}" class="input perm-select">
        <option value="read"${s.permission === 'read' ? ' selected' : ''}>read</option>
        <option value="write"${s.permission === 'write' ? ' selected' : ''}>write</option>
      </select>
      <button id="unshare-${s.granteeId}" class="btn danger sm" type="button">Remove</button>
    </div>
  </div>`;
}

// --- Account: your passkeys ---

async function showAccount(): Promise<void> {
  viewEl.innerHTML = `
    <div class="view-head">
      <h2>Your account</h2>
      <button id="add" class="btn" type="button">${icon('plus')} Add passkey</button>
    </div>
    <div class="panel">
      <span class="muted">Signed in as</span>
      <strong>${escapeHtml(host.user.email)}</strong>
      <span class="badge badge--${host.user.role}">${escapeHtml(host.user.role)}</span>
    </div>
    <h3 class="section-title">Passkeys</h3>
    <p id="msg" class="hint"></p>
    <section id="passkeys" class="grid"><p class="muted">Loading…</p></section>`;

  const msg = (text: string, isError = false): void => {
    const m = byId('msg');
    if (m) {
      m.textContent = text;
      m.classList.toggle('err', isError);
    }
  };

  byId('add')?.addEventListener('click', async () => {
    msg('Waiting for your passkey…');
    try {
      await registerPasskey(host.user.email);
      await showAccount();
    } catch (err) {
      msg((err as Error).message, true);
    }
  });

  const listEl = byId('passkeys');
  try {
    const passkeys = await listPasskeys();
    if (!listEl) return;
    listEl.innerHTML =
      passkeys.length === 0
        ? emptyState('No passkeys', 'Add one to sign in from this device.')
        : passkeys.map(passkeyRow).join('');
    for (const p of passkeys) {
      byId(`rm-${p.id}`)?.addEventListener('click', async () => {
        if (!window.confirm('Remove this passkey?')) return;
        try {
          await deletePasskey(p.id);
          await showAccount();
        } catch (err) {
          msg((err as Error).message, true);
        }
      });
    }
  } catch (err) {
    if (listEl) listEl.innerHTML = errorState((err as Error).message);
  }
}

function passkeyRow(p: Passkey): string {
  const used = p.lastUsedAt ? `last used ${fmtDate(p.lastUsedAt)}` : 'never used';
  return `<article class="card">
    <div class="card-body">
      <div class="card-title">${escapeHtml(p.deviceName ?? 'Passkey')}</div>
      <div class="badges"><span class="badge badge--muted">added ${fmtDate(p.createdAt)}</span>
        <span class="badge badge--muted">${used}</span></div>
    </div>
    <div class="card-actions"><button id="rm-${p.id}" class="btn danger sm" type="button">Remove</button></div>
  </article>`;
}

// --- Admin: user management ---

async function showAdmin(): Promise<void> {
  viewEl.innerHTML = `
    <div class="view-head"><h2>User management</h2></div>
    <form id="new-user" class="userform panel">
      <input id="nu-email" class="input" type="email" placeholder="email@example.com" required />
      <input id="nu-name" class="input" placeholder="Display name (optional)" />
      <select id="nu-role" class="input">
        <option value="user">user</option>
        <option value="admin">admin</option>
      </select>
      <button class="btn" type="submit">Create user</button>
    </form>
    <div id="invite-box"></div>
    <p id="msg" class="hint">New users receive an invitation link to create their passkey.</p>
    <section id="users" class="grid"><p class="muted">Loading…</p></section>`;

  const msg = (text: string, isError = false): void => {
    const m = byId('msg');
    if (m) {
      m.textContent = text;
      m.classList.toggle('err', isError);
    }
  };

  const refreshUsers = async (): Promise<void> => {
    const usersEl = byId('users');
    if (!usersEl) return;
    try {
      const users = await listUsers();
      usersEl.innerHTML = users.map((u) => userRow(u, host.user.id)).join('');
      for (const u of users) {
        if (u.id === host.user.id) continue;
        byId(`role-${u.id}`)?.addEventListener(
          'click',
          () =>
            void act(() => adminUpdateUser(u.id, { role: u.role === 'admin' ? 'user' : 'admin' })),
        );
        byId(`dis-${u.id}`)?.addEventListener(
          'click',
          () => void act(() => adminUpdateUser(u.id, { disabled: !u.disabled })),
        );
        byId(`inv-${u.id}`)?.addEventListener('click', async () => {
          try {
            renderInvite(await generateInvite(u.id), `Invitation for ${u.email}`);
          } catch (err) {
            msg((err as Error).message, true);
          }
        });
      }
    } catch (err) {
      usersEl.innerHTML = errorState((err as Error).message);
    }
  };

  const act = async (fn: () => Promise<unknown>): Promise<void> => {
    try {
      await fn();
      await refreshUsers();
    } catch (err) {
      msg((err as Error).message, true);
    }
  };

  byId('new-user')?.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const email = byId<HTMLInputElement>('nu-email')?.value.trim() ?? '';
    const name = byId<HTMLInputElement>('nu-name')?.value.trim() ?? '';
    const role = (byId<HTMLSelectElement>('nu-role')?.value ?? 'user') as 'admin' | 'user';
    if (!email) {
      msg('Email is required.', true);
      return;
    }
    try {
      const { user, invite } = await adminCreateUser({ email, displayName: name || email, role });
      await refreshUsers();
      renderInvite(invite, `Invitation for ${user.email}`);
    } catch (err) {
      msg((err as Error).message, true);
    }
  });

  await refreshUsers();
}

function renderInvite(invite: Invite, label: string): void {
  const box = byId('invite-box');
  if (!box) return;
  box.innerHTML = `<div class="invite panel">
    <div class="invite-head">
      <strong>${escapeHtml(label)}</strong>
      <span class="muted sm">expires ${fmtDate(invite.expiresAt)}</span>
    </div>
    <div class="field-row">
      <input id="invite-url" class="input" readonly value="${escapeHtml(invite.url)}" />
      <button id="invite-copy" class="btn" type="button">Copy</button>
    </div>
    <p class="hint sm">Send this link to the user. It lets them create a passkey once, then expires.</p>
  </div>`;
  const input = byId<HTMLInputElement>('invite-url');
  byId('invite-copy')?.addEventListener('click', async () => {
    const copyBtn = byId('invite-copy');
    try {
      await navigator.clipboard.writeText(invite.url);
      if (copyBtn) copyBtn.textContent = 'Copied ✓';
    } catch {
      input?.select();
    }
  });
  input?.focus();
  input?.select();
}

function userRow(u: AdminUser, selfId: string): string {
  const self = u.id === selfId;
  const pending = u.credentialCount === 0;
  const actions = self
    ? '<span class="muted sm">— you —</span>'
    : `${pending ? `<button id="inv-${u.id}" class="btn ghost sm" type="button">Invite</button>` : ''}
       <button id="role-${u.id}" class="btn ghost sm" type="button">${
         u.role === 'admin' ? 'Make user' : 'Make admin'
}</button>
       <button id="dis-${u.id}" class="btn ghost sm" type="button">${
         u.disabled ? 'Enable' : 'Disable'
}</button>`;
  return `<article class="card">
    <div class="card-body">
      <div class="card-title">${escapeHtml(u.email)}${self ? ' <span class="muted sm">(you)</span>' : ''}</div>
      <div class="badges">
        <span class="badge badge--${u.role}">${u.role}</span>
        <span class="badge ${u.disabled ? 'badge--disabled' : 'badge--active'}">${
          u.disabled ? 'disabled' : 'active'
        }</span>
        ${
          pending
            ? '<span class="badge badge--private">no passkey</span>'
            : `<span class="badge badge--muted">${u.credentialCount} passkeys</span>`
        }
        <span class="badge badge--muted">${u.artifactCount} artifacts</span>
      </div>
    </div>
    <div class="card-actions">${actions}</div>
  </article>`;
}

function fmtDate(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleDateString();
}
