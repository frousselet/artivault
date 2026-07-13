# Artivault

Self-hosted, open source service to **store, view, edit and version AI-generated
artifacts** (and their datasets), reachable from mobile, kept private behind
application authentication (with an optional public mode per artifact), and
writable by an LLM agent through an **MCP endpoint**.

> **Status:** early scaffold. The repository structure, tooling, database schema
> and route skeleton are in place; business logic is stubbed and marked with
> `TODO`. See [`docs/spec.md`](docs/spec.md) for the full design specification.

## Highlights

- **Private by default.** Access is guarded by application authentication
  (passkeys / WebAuthn), not by network placement. Any artifact can optionally be
  made public through an unguessable render URL.
- **Agent-writable.** An LLM (Claude or any MCP client) reads and writes
  artifacts and datasets through `/mcp`, authenticated with OAuth 2.1, acting
  under the authorizing user's own account.
- **Isolated rendering.** Artifacts contain arbitrary JavaScript and are served
  from a sandboxed, opaque origin (`Content-Security-Policy: sandbox …`) on the
  same domain, so they can never reach the session or the management API.
- **Versioned.** Every artifact and dataset keeps an unlimited, append-only
  version history; individual versions can be deleted or restored.
- **Collaborative.** Per-resource read/write sharing, serialized by a lock with
  an optimistic version check.

## Architecture

A single Node application, one origin, one container, behind any TLS-terminating
reverse proxy. All roles are served over paths on the same domain:

| Path | Purpose | Auth |
|---|---|---|
| `/` | GUI (single-page app) | Session cookie (passkey) |
| `/api/*` | Management REST API | Session cookie + CSRF token |
| `/artifact/<slug>` | Sandboxed artifact rendering | Session (private) / none (public) |
| `/api/render-data/<token>` | Data access for a sandboxed artifact | Capability token |
| `/mcp` | MCP endpoint (Streamable HTTP) | OAuth 2.1 bearer |
| `/oauth/*`, `/.well-known/*` | OAuth authorization server | Public discovery + login |

See the full specification in [`docs/spec.md`](docs/spec.md).

## Tech stack

- **Node LTS + TypeScript** (ES modules, `NodeNext`).
- **[Hono](https://hono.dev/)** as the HTTP framework (`@hono/node-server`).
- **better-sqlite3** for the main database and per-dataset SQLite files.
- **[SimpleWebAuthn](https://simplewebauthn.dev/)** for passkey authentication.
- **[@modelcontextprotocol/sdk](https://modelcontextprotocol.io/)** for the MCP endpoint.
- **[jose](https://github.com/panva/jose)** for capability / OAuth tokens.
- **markdown-it** to render Markdown artifacts to HTML server-side.
- **[zod](https://zod.dev/)** for config and request-schema validation.
- **[Vite](https://vite.dev/)** for the single-page web client (`web/`).
- **[Biome](https://biomejs.dev/)** for formatting and linting.

## Repository layout

```
artivault/
├── server/                 # Node + Hono backend (API, render, MCP, OAuth)
│   ├── src/
│   │   ├── config/         # environment loading & validation (zod)
│   │   ├── db/             # better-sqlite3 connection + SQL migrations
│   │   ├── routes/         # HTTP route skeletons (api, artifact, mcp, oauth)
│   │   ├── services/       # domain logic (artifacts, datasets, locks, …) — stubbed
│   │   ├── auth/           # passkeys, sessions, CSRF
│   │   ├── security/       # sandbox CSP, capability tokens
│   │   ├── mcp/            # MCP server + tool catalogue
│   │   ├── types/          # shared domain types
│   │   └── util/           # slug generation, logging
│   └── test/
├── web/                    # Vite single-page client
├── docs/spec.md            # full design specification
└── data/                   # runtime SQLite files (gitignored, created on boot)
```

## Getting started

Requires **Node ≥ 22** (a recent LTS; the repo is developed on Node 26) and a C/C++
toolchain for the `better-sqlite3` native build (Xcode Command Line Tools on macOS,
`build-essential` on Debian/Ubuntu).

```bash
# 1. Install dependencies (root + workspaces)
npm install

# 2. Create your environment file
cp .env.example .env
#   then edit .env — at minimum set the *_SECRET values

# 3. Apply database migrations (creates data/artivault.db)
npm run migrate

# 4. Run the backend (http://127.0.0.1:8787)
npm run dev

# 5. In another terminal, run the web client with hot reload
npm run dev:web
```

The first registered account becomes the **admin** (bootstrap rule).

## Scripts

Run from the repository root:

| Script | Description |
|---|---|
| `npm run dev` | Start the backend in watch mode |
| `npm run dev:web` | Start the Vite dev server for the web client |
| `npm run build` | Type-check and build both workspaces |
| `npm start` | Run the built backend |
| `npm run migrate` | Apply pending database migrations |
| `npm run typecheck` | Type-check every workspace |
| `npm test` | Run tests |
| `npm run lint` | Lint & format-check with Biome |
| `npm run format` | Auto-format with Biome |

## Security model (summary)

- Rendered artifacts run in an **opaque origin** via a `sandbox` CSP and cannot
  read cookies, `localStorage`, or make credentialed calls to `/api`.
- Data for sandboxed artifacts is reached through **short-lived capability
  tokens** bound to the render context, never the session cookie.
- Write endpoints require a **CSRF token** in addition to the session cookie,
  because untrusted artifact content is served from the same origin.
- Passkeys are bound to the single deployment domain (`RP_ID`); behind a proxy,
  `EXPECTED_ORIGIN` and `RP_ID` must be set to the public domain.

See [`SECURITY.md`](SECURITY.md).

## License

AGPL-3.0-only. (The `LICENSE` file will be added by the maintainer.)
