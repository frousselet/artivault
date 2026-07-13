# CLAUDE.md

Guidance for Claude Code (and other agents) working in this repository.

## What this is

Artivault — a self-hosted service to store, view, edit and version AI-generated
artifacts and their datasets, with passkey auth, per-resource sharing, an optional
public mode, and an MCP endpoint. **Read [`docs/spec.md`](docs/spec.md)** for the
authoritative design; it is the source of truth for behavior and decisions.

Current state: **scaffold**. Structure, tooling, DB schema and route skeleton exist;
domain logic is stubbed. Unimplemented handlers return HTTP `501` via the
`notImplemented()` helper. Grep for `TODO(spec` to find where to build.

## Commands

Run from the repo root (npm workspaces):

- `npm run dev` — backend in watch mode (tsx) on `HOST:PORT` (default `127.0.0.1:8787`)
- `npm run dev:web` — Vite dev server for the SPA
- `npm run migrate` — apply SQL migrations in `server/src/db/migrations`
- `npm run typecheck` — type-check all workspaces
- `npm test` — run tests (`node:test`)
- `npm run build` — build `server` then `web`
- `npm run lint` / `npm run format` — Biome

## Layout

- `server/src/config/env.ts` — zod-validated environment config (single source).
- `server/src/db/` — `index.ts` opens better-sqlite3 (WAL, foreign_keys on);
  `migrate.ts` runs `migrations/*.sql` tracked in `schema_migrations`.
- `server/src/routes/` — `health.ts`, `artifact.ts` (sandbox render),
  `api/` (management REST), `mcp.ts`, `oauth.ts`. Mounted in `server/src/app.ts`.
- `server/src/services/` — domain logic per resource (mostly stubs).
- `server/src/auth/` — passkeys (SimpleWebAuthn), sessions, CSRF.
- `server/src/security/` — `csp.ts` (sandbox header), `capability-tokens.ts` (jose).
- `server/src/mcp/` — MCP server wiring + `tools.ts` (the tool catalogue, spec §14).
- `server/src/types/domain.ts` — TypeScript mirror of the DB schema.
- `web/` — Vite single-page client.

## Conventions

- **ESM + `NodeNext`:** in `server/`, relative imports **must** end in `.js`
  (e.g. `import { openDb } from './db/index.js'`). The `web/` package uses the
  bundler resolver and does not.
- **`verbatimModuleSyntax` is on:** use `import type` for type-only imports.
- **better-sqlite3 is synchronous** — no `await` on DB calls; wrap multi-statement
  writes in transactions (`db.transaction(...)`).
- Biome: single quotes, semicolons, 2-space indent, 100 cols.
- Keep route handlers thin; put logic in `services/`.

## Security invariants — do not regress (see SECURITY.md, spec §11)

- `/artifact/<slug>` MUST send `Content-Security-Policy: sandbox allow-scripts
  allow-forms allow-popups` (no `allow-same-origin`). Use `applyArtifactSandbox()`.
- Never expose dataset content to a rendered artifact via the session cookie —
  only via capability tokens (`/api/render-data/<token>`), read-only.
- State-changing `/api` routes require the CSRF token in addition to the session.
- MCP actions run as the authorizing user and are written to `audit_log` with
  `actor_kind = 'agent'`.
- Writes obey the lock (spec §8) and the optimistic base-version check (spec §9).

## When implementing

Prefer completing one vertical slice at a time (e.g. passkey register/login, then
artifact CRUD, then render, then sharing/locks, then MCP tools). Update
`docs/spec.md`'s open items if a decision changes.
