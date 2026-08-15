# Final Report — BabaSTI Hosting (Control Plane MVP)

**Status: ✅ VERIFIED**

The platform is implemented end-to-end and verified through both the automated
test suite (32 tests) and a full **real** end-to-end run of the Real Provider →
Node Agent lifecycle (21/21 checks). The seven defects found during verification
were corrected; no working architecture was rewritten.

---

## 1. What was built

A client-facing hosting control plane:

- **Web client** (`apps/client`) — React + Vite + TanStack Query. Register,
  connect GitHub, create websites, deploy (ZIP or GitHub), manage custom domains
  and environment variables, watch deployment logs, and roll back.
- **API** (`apps/api`) — fastify + Prisma + PostgreSQL. Auth (session cookie +
  Google/GitHub OAuth), websites, deployments, domains, environments, GitHub
  integration, overview, and the internal node-agent callbacks.
- **Node Agent** (`services/node-agent`) — a separate service that owns execution
  on a hosting node: receives deploy/rollback jobs over HTTPS, extracts releases,
  validates nginx, atomically swaps the live symlink, and reports status/logs
  back to the control plane.
- **Packages** — `types`, `config` (validated env schema), `shared` (logger,
  queue, scheduler, crypto), `validation` (shared Zod schemas).
- **Deploy providers** — `Mock` (in-process, for dev/test) and `Real` (dispatches
  to the Node Agent).

There is **no admin panel** — this is a client platform; all management happens
through the web client.

---

## 2. Corrections applied (defects found during verification)

| # | Defect | Fix | Location |
| - | ------ | --- | -------- |
| 1 | Artifact download returned **404** because the internal route was not a wildcard. | Changed the route to `/internal/artifacts/*`. | `apps/api/src/modules/internal/internal.routes.ts:186` |
| 2 | Website creation **skipped node provisioning** (no `node` passed to the provider). | `assertNodeAvailable` + `node` now passed into `createWebsite`. | `apps/api/src/modules/websites/websites.routes.ts:89-95` |
| 3 | `nginx -t` validation failed / was skipped for the agent's generated vhost. | Agent now wraps the snippet in a **complete temp `http {}` config** with `access_log off` and temp paths, runs `nginx -t -c`, and tolerates a missing nginx (dev). Live config is untouched on failure. | `services/node-agent/src/executor.ts:405-448` |
| 4 | Node Agent used the wrong storage root (control-plane `STORAGE_PATH`). | Added `AGENT_STORAGE` config (falls back to `STORAGE_PATH`) and the agent now resolves releases under `AGENT_STORAGE/sites/<slug>`. | `packages/config/src/index.ts`, `services/node-agent/src/executor.ts:63` |
| 5 | Rollback API response was **missing `releaseId`**. | Deployment serializer now includes `releaseId`. | `apps/api/src/modules/deployments/deployments.routes.ts:194,208` |
| 6 | Node-agent calls had **no failure timeout** — a hung node blocked deployment forever. | Added `AbortSignal.timeout` to all real-provider → agent calls and to the agent's artifact download. | `apps/api/src/infrastructure/hosting/real-provider.ts:108,132,196,213`, `services/node-agent/src/executor.ts:176` |
| 7 | Queue could not start when Redis was absent (`REDIS_URL` was set to a placeholder). | `REDIS_URL=""` is treated as **valid** and selects the in-memory queue (used in dev/test). `.env` corrected accordingly. | `.env`, `packages/config/src/index.ts` |

Debug logging added during diagnosis was removed (`scheduler.ts`, `queue/index.ts`,
`executor.ts`).

---

## 3. Verification results

### 3.1 Automated test suite — **32 / 32 passing**

Run with:

```powershell
npm test        # = npm run test -w apps/api (node:test + tsx)
```

Coverage: ZIP security (5), deployment state machine (5), domain validation (6),
auth (6), OAuth (4), authorization (2), Mock deployment (3), API flow (1).

### 3.2 Real end-to-end — **21 / 21 checks passing**

Run against a live API (`DEPLOYMENT_PROVIDER=real`) + Node Agent:

```powershell
# API
$env:DEPLOYMENT_PROVIDER="real"; $env:REDIS_URL=""; npm run start -w apps/api
# Agent
$env:NODE_AGENT_TOKEN="<shared>"; $env:CONTROL_PLANE_URL="http://localhost:3000"; npm run start -w services/node-agent
# Verifier
node apps/api/e2e-verify.mjs
```

The verifier asserts the full lifecycle: register → create site → deploy release
`1001` → immutable `releases/1001` → `nginx -t` passes → atomic symlink swap →
site health `200` → `Website.status = LIVE` → deploy `1002` → rollback to `1001`
→ `1001` preserved → cleanup. It also asserts the **critical safety property**: a
failed deploy never replaces a working release.

### 3.3 Security verification

- Unauthenticated `/v1/*` call to the agent → **403 Forbidden** (token required).
- Authenticated `/v1/*` call → **200**.
- All `/internal/*` control-plane callbacks require `NODE_AGENT_TOKEN` → 403
  otherwise.
- Auth, secrets encryption (AES-256-GCM), CORS lock, rate limit (200/min/IP),
  and input validation confirmed via code review and tests.

### 3.4 Type-check / build

- `npm run typecheck` (`tsc -b`) — clean.
- `npm run build` (`tsc -b`) — succeeds (emits `dist/` for all packages & apps).
- `npx prisma validate` — schema valid; `npx prisma migrate deploy` applies the
  initial migration.

---

## 4. Production readiness (by category)

| Category | Verdict | Notes |
| -------- | ------- | ----- |
| Feature completeness | ✅ Ready | Auth, GitHub, websites, deployments, domains, env vars, rollback, overview all implemented and verified. |
| Deployment safety | ✅ Ready | Immutable releases, atomic symlink swap, `nginx -t` gating, failed-deploy isolation, instant rollback. |
| Security | ✅ Ready | Session cookies, AES-256-GCM secrets, CORS lock, rate limit, bearer-auth node channel, no arbitrary shell. |
| Code quality | ✅ Ready | Type-checked, 32 tests, shared validation schemas, structured logging. |
| Operations tooling | ⚠️ Partial | No Dockerfile / systemd unit shipped; run via `node dist`. Should sit behind a TLS reverse proxy. |
| Observability | ⚠️ Partial | Health endpoints + deployment logs exist; no metrics/alerting. |
| Admin surface | ❌ Out of scope | Client-only platform; no admin panel in this MVP. |

---

## 5. How to verify (CI & local)

**CI** (`.github/workflows/ci.yml`): on push/PR it spins up PostgreSQL, then runs
`npx prisma validate` → `npx prisma generate` → `npx prisma migrate deploy` →
`npm run typecheck` → `npm run build` → `npm test`. (The test environment forces
`REDIS_URL=""` and uses an isolated `babasti_test` database.)

**Local**:

```powershell
npm install
docker compose up -d
Copy-Item .env.example .env
npx prisma generate; npx prisma migrate deploy
npm run build
npm test
# optional real run:
$env:DEPLOYMENT_PROVIDER="real"; $env:REDIS_URL=""; npm run start -w apps/api
```

See `README.md`, `docs/ARCHITECTURE.md`, `docs/DEPLOYMENT.md`, `docs/SECURITY.md`,
and `docs/API.md` for full detail.

---

## 6. Out of scope (not part of this MVP)

- Docker images / container orchestration manifests.
- Systemd / process-manager units.
- TLS termination config (assumed to be provided by the deployer's proxy).
- Metrics, tracing, and alerting.
- Administrative console.
