# Security

## Authentication

- **Sessions, not JWTs in the browser.** On login we create an opaque token
  stored in the `Session` table and set it as an `httpOnly`, `sameSite`,
  `secure` (prod) cookie (`sessionId`). The token is hashed (SHA-256) before
  storage/lookup so a DB leak does not expose usable sessions.
- Passwords hashed with **bcrypt** (cost 10+). Plaintext is never persisted.
- **OAuth (Google/GitHub)**: manual authorization-code flow; we store only the
  provider + a token (encrypted) for GitHub repo access. No third-party JWTs are
  trusted client-side.

## Secrets at rest

- `EnvironmentVariableVisibility.SECRET` values and GitHub tokens are encrypted
  with **AES-256-GCM**. The key is scrypt-derived from `ENCRYPTION_KEY`
  (falling back to `SESSION_SECRET`). Auth tags prevent tampering. The API never
  returns secret values over the wire — only their presence and (for PUBLIC) the
  build-injected value.

## Transport & headers

- `@fastify/helmet` sets a restrictive CSP, `X-Content-Type-Options`,
  `X-Frame-Options`, etc.
- CORS is locked to `CLIENT_URL` and requires credentials; all other origins are
  rejected.
- Global rate limit (**200 req/min/IP**) mitigates brute force; auth endpoints can
  be further tightened.
- Request caps: global `bodyLimit` is **60 MB** and multipart uploads are capped at
  **50 MB** (`files: 1`) to prevent oversized payloads.

## Authorization

- Every mutating route runs `requireAuth` (and `requireOwnership` where a
  `websiteId` is in the path). A user can only act on resources they own.
- `UserRole` exists for future differentiation; the platform is client-only (no
  admin surface), so cross-tenant access is structurally impossible.

## Input handling

- **All** request bodies are validated with the shared Zod schemas in
  `@babasti/validation`, rejecting unknown keys and malformed input before it
  reaches business logic. The same schemas power client forms.
- Slugs are regex-constrained and checked against a `RESERVED_SLUGS` blocklist.
- All DB access goes through Prisma (parameterized), eliminating SQL injection.

## Hosting node trust boundary

- **The browser never talks to Proxmox or any hypervisor.** The control plane
  orchestrates; the Node Agent is the only component that executes on a hosting
  node. The control plane itself never runs shell commands against nodes.
- The control plane ↔ Node Agent channel is authenticated with a shared
  `NODE_AGENT_TOKEN` bearer header. Every `/internal/*` callback handled by the
  control plane **and** every `/v1/*` endpoint handled by the agent requires the
  token; a missing or invalid token is rejected with **403 Forbidden**.
- Deployment artifacts are streamed and extracted in a sandboxed temp dir; only
  the resolved output directory is promoted to an immutable release.
- **nginx is validated before any live change.** The agent wraps the generated
  vhost snippet in a complete temp `http { }` config and runs `nginx -t`. A
  failing check leaves the live config untouched and the deployment is marked
  `FAILED` — a bad release can never break the running server.
- **No arbitrary shell execution.** The agent runs a small, fixed set of commands
  (extract, symlink swap, `nginx -t`, reload). It does not accept or evaluate
  free-form shell from the control plane.

## Operational

- Logs never include secrets or tokens (the `logger` redacts known fields).
- `trustProxy` is enabled so `secure` cookies and rate limits work behind a TLS
  terminator; ensure your proxy sets correct `X-Forwarded-*` and is the only
  trusted hop.
- Rotate `SESSION_SECRET` / `ENCRYPTION_KEY` on a schedule; rotating
  `ENCRYPTION_KEY` requires re-encrypting stored secrets.

## Reporting

Report suspected vulnerabilities to **security@babasti.my.id**. Do not open
public issues for security matters.
