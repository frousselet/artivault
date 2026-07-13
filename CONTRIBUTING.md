# Contributing to Artivault

Thanks for your interest in contributing. This document covers the essentials;
the full design lives in [`docs/spec.md`](docs/spec.md).

## Development setup

See the [Getting started](README.md#getting-started) section of the README.
Requires Node ≥ 22 and a C/C++ toolchain for the `better-sqlite3` native build.

## Workflow

1. Create a branch off `main`.
2. Make your change, keeping it focused.
3. Before opening a PR, make sure the checks pass locally:
   ```bash
   npm run lint
   npm run typecheck
   npm test
   npm run build
   ```
4. Open a pull request describing the change and linking any related issue.

CI runs the same checks on every push and pull request.

## Code conventions

- **TypeScript, ES modules, `NodeNext`.** In the `server/` package, relative
  imports **must include the `.js` extension** (e.g. `import { openDb } from './db/index.js'`),
  because the compiled output is native ESM.
- **`verbatimModuleSyntax` is on.** Import types with `import type { … }` (or
  inline `import { type Foo }`) so nothing type-only survives into the emitted JS.
- **Formatting & linting** are handled by [Biome](https://biomejs.dev/):
  single quotes, semicolons, 2-space indent, 100-column width. Run
  `npm run format` before committing.
- Keep domain logic in `server/src/services/*`; keep route handlers thin.
- Every write path must go through the audit log and respect the locking and
  optimistic-version rules described in the spec (§8, §9).

## Security-sensitive changes

Some invariants must never regress. Before touching rendering, sessions, CSRF,
capability tokens, or the MCP/OAuth flow, read [`SECURITY.md`](SECURITY.md) and
the relevant spec sections (§10, §11, §14). If in doubt, ask in the PR.

## License

By contributing, you agree that your contributions are licensed under the
project's AGPL-3.0-only license.
