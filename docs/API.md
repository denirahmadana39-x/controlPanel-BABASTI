# API Reference

Base URL (dev): `http://localhost:3000`. All JSON responses are wrapped as
`{ "data": ... }` on success. Errors are `{ "error": { "code", "message" } }`.

Authentication uses an httpOnly session cookie (`sessionId`). Send
`Cookie` and expect `Set-Cookie`; CORS is configured for `CLIENT_URL` with
credentials. OAuth flows are browser redirects to `/api/auth/google` /
`/api/auth/github`.

## Auth — `/api/auth`

| Method | Path                   | Auth | Body / Notes                                  |
| ------ | ---------------------- | ---- | --------------------------------------------- |
| POST   | `/register`            | —    | `{ email, password, displayName }`            |
| POST   | `/login`               | —    | `{ email, password }`                         |
| POST   | `/logout`              | ✓    | —                                             |
| GET    | `/me`                  | ✓    | current user                                  |
| GET    | `/google`              | —    | redirect to Google (if configured)           |
| GET    | `/google/callback`     | —    | OAuth redirect target                         |
| GET    | `/github`              | —    | redirect to GitHub (if configured)            |
| GET    | `/github/callback`     | —    | OAuth redirect target                         |

`email` must be a valid address; `password` ≥ 8 chars. Returns the `User`
(`id, email, displayName, role, createdAt`).

## Websites — `/api/websites`

| Method | Path            | Auth | Body / Notes                                          |
| ------ | --------------- | ---- | ----------------------------------------------------- |
| GET    | `/`             | ✓    | list owned websites (+ `lastDeployment`, counts)      |
| POST   | `/`             | ✓    | `{ name, slug?, framework?, buildCommand?, outputDir? }` |
| GET    | `/:id`          | ✓    | website detail (+ `domains`, `lastDeployment`, counts)|
| PATCH  | `/:id`          | ✓    | update mutable fields                                 |
| DELETE | `/:id`          | ✓    | delete website + all releases on the node             |

`slug` must match `^[a-z0-9]([a-z0-9-]{1,30})[a-z0-9]$`, be unique, and not be a
reserved word (`www`, `api`, `admin`, `app`, …). The default domain
`<slug>.babasti.my.id` is created automatically.

## Deployments

Nested — `/api/websites/:websiteId/deployments`:

| Method | Path                  | Auth | Body / Notes                                         |
| ------ | --------------------- | ---- | ---------------------------------------------------- |
| POST   | `/`                   | ✓    | `{ source: "ZIP" \| "GITHUB", zipConfig?, githubConfig? }` |
| GET    | `/`                   | ✓    | list deployments for the website                     |
| POST   | `/:deploymentId/rollback` | ✓ | roll back to the release produced by that deployment |
| POST   | `/:deploymentId/cancel`   | ✓ | cancel a queued/running deployment              |

`zipConfig`: `{ fileName }` referencing the previously uploaded artifact (or the
multipart field is read directly). `githubConfig`: `{ repoFullName, branch?,
autoDeploy? }`.

Single — `/api/deployments`:

| Method | Path           | Auth | Notes                              |
| ------ | -------------- | ---- | ---------------------------------- |
| GET    | `/:id`         | ✓    | deployment detail                  |
| GET    | `/:id/logs`    | ✓    | streaming/JSON deployment log lines|

A deployment progresses: `QUEUED → BUILDING → DEPLOYING → LIVE` (or `FAILED`).
The control plane streams logs (`BUILD`, `DEPLOY`, `SYSTEM`, `ERROR` levels) and
updates the release symlink atomically on the hosting node.

## Domains — `/api/websites/:websiteId/domains`

| Method | Path           | Auth | Body / Notes                          |
| ------ | -------------- | ---- | ------------------------------------- |
| GET    | `/`            | ✓    | list custom domains                   |
| POST   | `/`            | ✓    | `{ domain, primary? }`                |
| DELETE | `/:domainId`   | ✓    | remove custom domain                  |

Custom domains must be verified (DNS `CNAME`/records) before `status` → `ACTIVE`.
The system emits verification instructions in the response.

## Environment — `/api/websites/:websiteId/environment`

| Method | Path | Auth | Body / Notes                                        |
| ------ | ---- | ---- | --------------------------------------------------- |
| GET    | `/`  | ✓    | current variables (secret values are **never** returned) |
| PUT    | `/`  | ✓    | replace all variables `{ variables: [{ key, value, visibility }] }` |
| POST   | `/`  | ✓    | append/update a single variable                     |

`visibility` is `PUBLIC` (injected into the build) or `SECRET` (encrypted at rest,
injected at runtime only). Secret values are encrypted with AES-256-GCM.

## GitHub — `/api/github`

| Method | Path            | Auth | Notes                                  |
| ------ | --------------- | ---- | -------------------------------------- |
| GET    | `/connect`      | ✓    | redirect to GitHub to authorize        |
| GET    | `/callback`     | ✓    | OAuth redirect target                  |
| GET    | `/repositories` | ✓    | list repos (requires a stored token)   |
| DELETE  | `/disconnect`   | ✓    | remove the stored token                |

## Users — `/api/users`

| Method | Path             | Auth | Body / Notes                       |
| ------ | ---------------- | ---- | ---------------------------------- |
| GET    | `/me`            | ✓    | profile + connected accounts + sessions |
| PATCH   | `/me`            | ✓    | `{ displayName }`                  |
| POST    | `/password`      | ✓    | `{ currentPassword, newPassword }` |
| GET    | `/sessions`      | ✓    | active sessions                    |
| DELETE  | `/sessions/:id`  | ✓    | revoke a session (self or other)   |

## Overview — `/api/overview`

`GET /` (auth) → aggregate stats: `totalWebsites`, `liveWebsites`,
`totalDeployments`, `totalBandwidth`, `totalBuildMinutes`, recent deployments,
per-status website counts.

## Internal (Node Agent) — `/internal`

> **Note:** these routes are mounted at `/internal/*` — **not** `/api/internal/*`.

`POST /nodes` is guarded by `NODE_REGISTRATION_TOKEN`. Other internal endpoints
accept a registered node's unique `NODE_AGENT_TOKEN`. A missing, wrong, or
cross-node heartbeat token is rejected with **403 Forbidden**; agents enforce
their own token on every `/v1/*` endpoint as well.

| Method | Path                                | Notes                                            |
| ------ | ----------------------------------- | ------------------------------------------------ |
| GET    | `/health`                           | control-plane health (token required)            |
| POST   | `/nodes`                            | agent self-registers (`name`, `baseUrl`, …)      |
| POST   | `/nodes/:id/heartbeat`              | refresh node liveness and capabilities            |
| GET    | `/artifacts/*`                      | agent downloads a deployment artifact by key     |
| POST   | `/deployments/:id/status`           | agent reports deploy/rollback status + logs      |
| POST   | `/deployments/:id/log`              | agent streams a single deployment log line       |
| POST   | `/deployments/:id/finalize`         | finalize hook used to conclude a deployment      |

The **Node Agent** (separate service) exposes its own contract under `/v1/*`,
also bearer-protected:

| Method | Path                          | Notes                                         |
| ------ | ----------------------------- | --------------------------------------------- |
| GET    | `/health`                     | open agent health                             |
| POST   | `/v1/websites`                | provision a site (`websiteId`, `slug`, `domains`) |
| DELETE | `/v1/websites/:websiteId`     | tear down a site and its releases             |
| POST   | `/v1/deployments`             | start a deployment (202 Accepted, async)      |
| POST   | `/v1/rollbacks`               | start a rollback to a release                 |
| GET    | `/v1/websites/:websiteId/status`  | live release number, status, domains       |
| GET    | `/v1/websites/:websiteId/usage`   | per-site usage snapshot                    |

## Error codes

`ErrorCode` (subset): `VALIDATION`, `UNAUTHENTICATED`, `FORBIDDEN`,
`NOT_FOUND`, `CONFLICT`, `RATE_LIMITED`, `PAYLOAD_TOO_LARGE`, `INTERNAL`,
`EXTERNAL`. Rate limit is 200 req/min per IP by default.
