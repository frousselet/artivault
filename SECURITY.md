# Security Policy

Artivault stores private, user-owned content and lets an autonomous agent write
to it, so security is a first-class concern.

## Reporting a vulnerability

Please report suspected vulnerabilities **privately**, not through public issues.
Use GitHub's private vulnerability reporting (Security → Report a vulnerability)
for this repository, or contact the maintainer directly.

> **Maintainer:** update this section with a private security contact before the
> first public release.

We aim to acknowledge reports promptly and to coordinate disclosure once a fix is
available.

## Security model invariants

These properties are load-bearing. Changes that weaken them should be treated as
security regressions and reviewed accordingly.

- **Sandboxed rendering.** `GET /artifact/<slug>` serves untrusted content with
  `Content-Security-Policy: sandbox allow-scripts allow-forms allow-popups`
  (no `allow-same-origin`). The document runs in an opaque origin and cannot read
  the application's cookies or `localStorage`, nor make credentialed same-origin
  calls to `/api`.
- **Capability-token data access.** A sandboxed artifact reaches its datasets only
  through short-lived capability tokens (`/api/render-data/<token>`) bound to the
  render context, artifact and dataset — never via the session cookie. These grant
  read-only access; writes are impossible from a rendered document.
- **CSRF protection.** Because untrusted content is served from the same origin,
  state-changing `/api` requests require a CSRF token in addition to the
  HttpOnly, Secure session cookie.
- **Passkey binding.** WebAuthn is bound to the single deployment domain via
  `RP_ID`. Behind a reverse proxy, `RP_ID` and `EXPECTED_ORIGIN` must be set to
  the public domain and forwarded headers trusted, or verification fails.
- **Agent scoping.** MCP tokens are issued through OAuth 2.1 and bound to the
  authorizing user's account; every agent action runs with exactly that user's
  permissions and is recorded in the audit log with `actor_kind = agent`.
- **Server-side sessions.** Sessions are stored server-side so they can be revoked.

## Slugs are not access grants (for private resources)

The unguessable `<slug>` prevents enumeration but, for a private artifact, is not
itself an access grant: rendering still requires an authenticated session and a
permission check. For a **public** artifact the slug is the capability — anyone
holding the link can render it. Regenerating the slug revokes old public links.
