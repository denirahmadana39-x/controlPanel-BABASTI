# Deployment & Operations

This document covers running BabaSTI Hosting for real, the lifecycle of a
deployment, rollback safety, and how to reproduce the end-to-end verification.

> The **Mock** provider (`DEPLOYMENT_PROVIDER=mock`) is for local development
> only — it builds and serves sites in-process. Production uses the **Real**
> provider, which dispatches all execution to a **Hosting Node Agent**.

---

## 1. Production readiness checklist

| Area | Status | Notes |
| --- | --- | --- |
| Environment validation | ✅ | Central schema fails fast on missing/invalid vars |
| Secrets encryption | ✅ | AES-256-GCM for OAuth tokens & `SECRET` env vars |
| Session security | ✅ | Opaque DB sessions; `httpOnly`, `sameSite=lax`, `secure` in prod |
| CORS | ✅ | Locked to `CLIENT_URL` |
| Rate limiting | ✅ | 200 req/min/IP global limit |
| Input validation | ✅ | Shared Zod schemas (API + client) |
| Atomic deployments | ✅ | Immutable releases + symlink swap, zero downtime |
| Rollback | ✅ | Re-points `current` to a prior release |
| Failed-deploy safety | ✅ | A failed deploy never replaces a working release |
| nginx validation | ✅ | `nginx -t` on a full temp config before any live change |
| Agent auth | ✅ | Unique per-node bearer tokens; separate bootstrap token for registration |
| Node liveness | ✅ | Periodic heartbeat; stale nodes automatically become `OFFLINE` |
| Multi-node placement | ✅ | Website and deployment remain pinned to the node owning their releases |
| Queue | ✅ | Redis-backed; in-memory fallback when `REDIS_URL` is empty |
| Ops tooling | ✅ | Example systemd, nginx, environment, and cloudflared files under `deploy/examples/` |
| TLS | ⚠️ | Run behind a TLS-terminating reverse proxy (nginx/Caddy) |
| Admin panel | ❌ | Not part of this MVP (client-only platform) |

---

## 2. Running the services

Build everything once (emits `dist/` for each package/app):

```powershell
npm run build
```

### 2.1 API (control plane)

```powershell
# required env (see docs/API.md + README env table)
$env:NODE_ENV="production"
$env:DATABASE_URL="postgresql://babasti:<pw>@db:5432/babasti"
$env:API_PORT="3000"
$env:CLIENT_URL="https://app.example.com"
$env:SESSION_SECRET="<long-random>"
$env:COOKIE_SECURE="true"
$env:DEPLOYMENT_PROVIDER="real"
$env:NODE_REGISTRATION_TOKEN="<registration-only-secret>"
$env:NODE_HEARTBEAT_TTL_SECONDS="90"
# Optional legacy fallback for a single node only:
$env:NODE_AGENT_URL=""
$env:NODE_AGENT_TOKEN=""
$env:CONTROL_PLANE_URL="https://cp.example.com"
$env:REDIS_URL="redis://redis:6379"
$env:STORAGE_PATH="/var/lib/babasti/storage"
$env:CLOUDFLARE_ZONE_ID="<babasti.my.id-zone-id>"
$env:CLOUDFLARE_API_TOKEN="<zone-dns-write-token>"
# Optional only when the private Agent hostname is behind Cloudflare Access:
$env:CLOUDFLARE_ACCESS_CLIENT_ID="<service-token-client-id>"
$env:CLOUDFLARE_ACCESS_CLIENT_SECRET="<service-token-secret>"

npm run start -w apps/api
```

### 2.2 Hosting Node Agent

Run one agent per hosting node. It advertises its own `PUBLIC_AGENT_URL` during
registration, and it must be able to reach the control plane at
`CONTROL_PLANE_URL` (to download artifacts and report status).

```powershell
$env:NODE_ENV="production"
$env:AGENT_PORT="4000"
$env:NODE_NAME="proxmox-node-1"
$env:PUBLIC_AGENT_URL="https://agent2.internal.babasti.my.id"
$env:NODE_AGENT_TOKEN="<unique-secret-for-this-node>"
$env:NODE_REGISTRATION_TOKEN="<registration-only-secret>"
$env:CONTROL_PLANE_URL="https://cp.example.com"
$env:STORAGE_PATH="/var/lib/babasti-agent/storage"   # agent-managed releases live here
# AGENT_STORAGE optional; defaults to STORAGE_PATH
$env:AGENT_STORAGE="/var/lib/babasti-agent/storage"
$env:AGENT_NGINX_CONFIG_DIR="/etc/nginx/conf.d"
$env:AGENT_NGINX_BINARY="nginx"
$env:CLOUDFLARE_TUNNEL_TARGET="<this-node-tunnel-uuid>.cfargotunnel.com"
# Optional only when the control-plane internal route is behind Access:
$env:CLOUDFLARE_ACCESS_CLIENT_ID="<service-token-client-id>"
$env:CLOUDFLARE_ACCESS_CLIENT_SECRET="<service-token-secret>"

npm run start -w services/node-agent
```

On boot the agent self-registers with the control plane
(`POST /internal/nodes`), stores its returned node id, and starts heartbeat
requests. The scheduler considers only fresh `ONLINE` nodes for new websites.
The agent service user must be able to write `AGENT_NGINX_CONFIG_DIR` and run
`nginx -t` / `nginx -s reload`. Production real-provider mode refuses to mark a
release online when this directory is not configured.

Configure the same tunnel on each HostingNode with a wildcard ingress rule for
`*.babasti.my.id` pointing to the node's local nginx. The control plane creates
one proxied CNAME per website and points it at the tunnel target advertised by
the selected node. Use a Cloudflare API token restricted to the
`babasti.my.id` zone with DNS Write; do not use a Global API key.

Do not put the public customer wildcard behind Cloudflare Access: deployed
websites must remain publicly reachable. Access is appropriate for Proxmox and
private Agent hostnames. When used, the service token id and secret are added to
control-plane → Agent calls, Agent registration/heartbeat, and artifact
downloads; the two values must always be configured as a pair.

For the exact two-node BabaSTI topology, use
[`PROXMOX-ROLLOUT.md`](PROXMOX-ROLLOUT.md) and the non-secret templates in
`deploy/examples/`.

---

## 3. Real deployment lifecycle

```mermaid
sequenceDiagram
  participant U as User
  participant API as Control Plane (API)
  participant Q as Queue
  participant A as Node Agent
  participant N as nginx

  U->>API: POST /api/websites (create site)
  API->>A: POST /v1/websites (provision)
  A-->>API: { nodeId }
  U->>API: POST /api/websites/:id/deployments
  API->>Q: enqueue deploy job
  Q->>API: worker picks job (processDeployJob)
  API->>A: POST /v1/deployments (artifact URL + token)
  A->>API: GET /internal/artifacts/:key (download)
  A->>A: extract → releases/<n>/ (immutable)
  A->>A: validate nginx vhost + extraction limits
  A->>N: atomically install vhost; nginx -t; reload
  A->>A: atomic swap current → releases/<n>
  A->>N: GET / with site Host header → 2xx/3xx?
  API->>A: poll deployment status/logs
  API->>API: finalize Release, Website.status = LIVE
```

Key properties:

- **Immutable releases.** Each deploy writes a brand-new `releases/<n>/`
  directory. Existing releases are never mutated.
- **Atomic switch.** The live `current` symlink is swapped via `rename` only
  after the release is fully extracted and the nginx config passes
  validation. In-flight requests are uninterrupted.
- **Verified before serving.** The agent performs a real request through local
  nginx with the site's Host header; the control plane only marks
  `Website.status = ONLINE` after the
  agent reports `SUCCESS`.
- **nginx safety.** Before reloading, the agent wraps the vhost snippet in a
  complete `http { }` config in a temp directory and runs `nginx -t`. If the
  check fails, the live config is **not** touched and the deployment is marked
  `FAILED`.

### 3.1 Rollback safety

`POST /api/websites/:websiteId/deployments/:id/rollback` instructs the agent to
re-point `current` at a previously successful release and reload nginx. Because
releases are immutable and the swap is atomic, rollback is the same operation as
a deploy but without building anything — it always lands on a known-good state.

### 3.2 Failed deployment must not replace a live site

If a build/extract/nginx-validation/health step fails, the agent reports
`FAILED` and leaves `current` pointing at the previous good release. The control
plane records `DeploymentStatus.FAILED`, keeps `Website.status = LIVE` (if it was
already live), and the site keeps serving the prior release. Only a fully
verified release ever becomes `current`.

---

## 4. Node Agent storage

The agent stores everything under `AGENT_STORAGE` (falls back to `STORAGE_PATH`
when unset):

```
<AGENT_STORAGE>/
  sites/
    <slug>/
      releases/
        1001/        # immutable release (files + recorded nginx config)
        1002/
      current -> releases/1002   # symlink nginx serves
      tmp/                       # staging dir for the next release
```

`AGENT_STORAGE` lets you separate control-plane artifact storage from
agent-managed release storage (e.g. a node-local disk) without changing code.

---

## 5. Health checks

- **Control plane:** `GET /health` (root) and `GET /internal/health` (both
  require the node bearer token on `/internal/*`). Return `{ status: "ok" }`.
- **Agent:** `GET /health` (open). Returns a JSON status object.
- **Per-site:** the agent `GET /v1/websites/:websiteId/status?slug=<slug>`
  returns whether a live release link exists. Successful deployment health is
  additionally verified through local nginx before `SUCCESS` is reported.

---

## 6. Real End-to-End Verification

A reproducible verifier (`apps/api/e2e-verify.mjs`) exercises the **full real
lifecycle** against a running API + Node Agent. It performs 20 assertions,
including the critical safety properties.

### 6.1 Prerequisites

- A running PostgreSQL (e.g. Docker) and Redis (or leave `REDIS_URL=""` for the
  in-memory queue).
- A built API and a built Node Agent, both running with `DEPLOYMENT_PROVIDER=real`.

### 6.2 Run

```powershell
# terminal 1 — API
$env:DEPLOYMENT_PROVIDER="real"
$env:REDIS_URL=""
npm run start -w apps/api

# terminal 2 — Node Agent
$env:NODE_AGENT_TOKEN="<shared>"
$env:CONTROL_PLANE_URL="http://localhost:3000"
npm run start -w services/node-agent

# terminal 3 — verifier (expects API on :3000, agent on :4000 by default)
node apps/api/e2e-verify.mjs
```

### 6.3 What it checks (20 assertions)

The verifier checks registration/session/login, website creation, two ZIP
deployments, release numbers and on-disk content, `ONLINE` state, immutable
release switching, rollback, and authenticated/unauthenticated agent access.
The exact 20 assertion names live beside the workflow in
`apps/api/e2e-verify.mjs`, preventing the documented count from drifting.
