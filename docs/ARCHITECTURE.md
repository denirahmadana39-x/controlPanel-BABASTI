# Architecture

BabaSTI Hosting is a multi-node hosting control plane. The **control plane**
(API) stores metadata, orchestrates deployments and serves the SPA. **Hosting
nodes** run the actual sites (nginx + release directories). A clean
`HostingProvider` interface lets the control plane target either an in-process
**Mock** node (local/dev) or real **Node Agent** nodes (production) without
changing business logic.

```
┌─────────────┐     HTTPS /api      ┌──────────────────┐
│  React SPA  │ ───────────────────▶│  Fastify API     │──▶ PostgreSQL
│  (client)   │ ◀───────────────────│  (control plane) │   Prisma
└─────────────┘    JSON + cookies   │                  │──▶ Queue (memory/Redis)
                                    └────────┬─────────┘
                                             │ HostingProvider
                          ┌──────────────────┼───────────────────┐
                          ▼                  ▼                    ▼
                   Mock provider      Real provider        (more nodes…)
                   (in-process)       ──▶ Node Agent ──▶ nginx + releases
```

```mermaid
flowchart TB
  U[User / Browser] -->|HTTPS| C[React Client :5173]
  C -->|REST /api/*| API[API :3000 fastify + Prisma]
  API --> DB[(PostgreSQL)]
  API --> Q[(Redis Queue)]
  API -->|select node| SCHED[Scheduler]
  API -->|POST /v1/*| AGENT[Node Agent :4000]
  AGENT -->|download artifact| API
  AGENT -->|report status / logs| API
  AGENT --> FS[AGENT_STORAGE/sites/&lt;slug&gt;/{releases/&lt;n&gt;,current,temp}]
  AGENT --> NGINX[nginx proxy]
  NGINX -->|serve| SITE[User website]
```

## Packages

- **`@babasti/types`** — enums (`UserRole`, `WebsiteStatus`, `DeploymentStatus`,
  `DeploymentSource`, `DomainStatus`, `EnvironmentVariableVisibility`,
  `NodeStatus`) and shared value objects. Compiled, no runtime deps.
- **`@babasti/validation`** — Zod schemas. The *single source of truth* used by
  both the API (request validation) and the client (form validation), so the
  contract can never drift.
- **`@babasti/config`** — typed env loader (fails fast on missing required vars).
- **`@babasti/shared`** — `AppError`/`ErrorCode`, structured `logger`, utils.

## Control plane (apps/api)

Layered: `infrastructure → modules → app/server`.

### Infrastructure
- `database/prisma.ts` — Prisma client singleton + graceful `$disconnect`.
- `crypto/encryption.ts` — AES-256-GCM (scrypt-derived key) for secrets at rest.
- `storage/` — artifact (ZIP) persistence on disk or S3.
- `queue/` — `DeploymentQueue` interface; in-memory default + Redis-backed impl.
- `hosting/` — provider abstraction:
  - `types.ts` — `HostingProvider`, `HostingNode`, `DeployContext`, `DeployResult`.
  - `zip-utils.ts` — streamed ZIP extract (yauzl), finds `dist/`/`build/` output.
  - `mock-provider.ts` — full in-process node (writes nginx vhosts + releases to
    `STORAGE_PATH`, swaps symlinks, reloads nginx). No external agent needed.
  - `real-provider.ts` — forwards `registerWebsite / deploy / rollback / status /
    usage` to a Node Agent over HTTPS with a bearer token.
  - `scheduler.ts` — node selection, assignment, heartbeats, capacity tracking.
- `auth/` — `password.ts` (bcrypt), `session.ts` (opaque DB sessions,
  httpOnly cookie), `google.ts` / `github.ts` (manual OAuth code exchange).

### Modules
Each module has `*.routes.ts` (Fastify registration + validation) and, where
non-trivial, `*.service.ts`. Modules: `auth`, `websites`, `deployments`,
`domains`, `environments`, `github`, `users`, `overview`, `internal`.

## Deployment flow (ZIP)

1. Client `POST /api/websites/:id/deployments` with `source: "ZIP"` (multipart
   upload, ≤50 MB). The file is streamed to artifact storage.
2. A `Deployment` row is created (`QUEUED`); the job is enqueued.
3. Worker (`processDeployJob`) downloads/extracts the ZIP, locates the output
   directory, uploads it to the hosting node via `provider.deploy()`.
4. The node writes an **immutable release** to `releases/<n>/`, then atomically
   switches the `current` symlink → zero downtime. nginx is reloaded.
5. On success the control plane records a `Release`, updates `Website.status =
   LIVE`, and increments usage. On failure it marks `FAILED` and (if a prior
   release exists) keeps the site serving the previous release.
6. `POST .../rollback` re-points the symlink to an earlier release.

The GitHub API and client integration are scaffolded, but real-provider GitHub
deployments remain disabled until clone/build execution is isolated in a
resource-limited container. The public MVP accepts pre-built static ZIP files.

## Zero-downtime releases (Node Agent)

Each site is stored under `<AGENT_STORAGE>/sites/<slug>/`, where `AGENT_STORAGE`
defaults to the shared `STORAGE_PATH` when unset. The layout is
`{releases/<n>, current, temp}`. nginx serves the `current` symlink. A new
deploy writes to a fresh release dir, then the agent swaps
`current → temp → new release` in an atomic `rename`. In-flight requests are
uninterrupted. Rollback is the same swap in reverse.

## Multi-node

`DEPLOYMENT_PROVIDER=real` makes the scheduler pick a fresh healthy node using
heartbeat TTL and assigned-website count. The selected node's encrypted
`baseUrl` and unique token are used for every create/deploy/status/usage/delete
operation. `Website.nodeId` is stable placement; `Deployment.nodeId` is its
immutable execution snapshot. Nodes self-register with the separate
`NODE_REGISTRATION_TOKEN`, then heartbeat with their individual
`NODE_AGENT_TOKEN`. A draining node keeps existing sites but receives no new
placements.

## Public hostname routing

Each node advertises its own `<tunnel-uuid>.cfargotunnel.com` DNS target during
registration. After node placement, the control plane creates or updates a
proxied CNAME for `<slug>.<DEFAULT_DOMAIN_SUFFIX>` pointing to that exact
tunnel and stores the provider record id for cleanup. Therefore Cloudflare
routes the hostname to the same node that owns the website releases; no public
Proxmox or nginx port is required. Production real-provider mode fails website
creation when the node target or zone-scoped Cloudflare DNS credentials are
missing.

## Security model

- Opaque server-side sessions; no JWTs in the browser. Cookies are `httpOnly`,
  `sameSite=lax`, `secure` in production, scoped to `PATH=/`.
- Secrets (OAuth tokens, SECRET env vars) encrypted with AES-256-GCM.
- `helmet`, CORS locked to `CLIENT_URL`, global rate limit.
- All inputs validated by shared Zod schemas; Prisma parameterized queries prevent
  injection. See [SECURITY.md](SECURITY.md).
