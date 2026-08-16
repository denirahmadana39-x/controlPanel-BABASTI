# BabaSTI two-Proxmox rollout

This is the production rollout for the current MVP: customers upload a
pre-built static ZIP, BabaSTI places the website on one hosting node, publishes
its DNS record, deploys an immutable release, and makes it public. GitHub builds
and arbitrary server applications remain disabled until an isolated container
runner exists.

## 1. Target topology

| Machine | Workload | Initial allocation | Storage role |
| --- | --- | --- | --- |
| miniPC / Proxmox 3 (i3 gen 10, 8 GB, 256 GB SSD) | CT 121 cloudflared | 1 vCPU, 256 MB, 4 GB | Tunnel only |
| | CT 122 control plane + client | 2 vCPU, 2 GB, 25 GB | API and built web UI |
| | CT 123 PostgreSQL + Redis | 2 vCPU, 2 GB, 50 GB | Primary application data |
| | CT 124 HostingNode | 2 vCPU, 2 GB, 80 GB | Fast customer sites |
| babasti / Proxmox 2 (i5 gen 2, 4 GB, 1 TB HDD) | CT 111 HostingNode | 3 vCPU, 2.5 GB, 300 GB | Capacity-tier customer sites |

Keep at least 1 GB RAM for each Proxmox host. Use dynamic memory/ballooning only
after observing real usage. The two hosts remain independent; do not create a
two-node Proxmox cluster across an unreliable WAN because quorum loss can make
management harder. BabaSTI's application scheduler provides node placement;
this is not Proxmox HA.

## 2. Public and private names

- `panel.babasti.my.id`: customer dashboard on CT 122.
- `api.babasti.my.id`: control-plane API on CT 122.
- `agent2.babasti.my.id`: private Agent route to CT 111.
- `agent3.babasti.my.id`: private Agent route to CT 124.
- `<customer-slug>.babasti.my.id`: public customer website; created by the API.
- `proxmox2.babasti.my.id` and `proxmox3.babasti.my.id`: existing management
  names; keep them outside customer DNS automation and protect them with Access.

Protect Proxmox and Agent names with Cloudflare Access. Do not protect the
customer wildcard with Access. The application also reserves all management
slugs so a customer cannot request those DNS names.

## 3. Back up before rollout

1. Create a Proxmox backup or snapshot of CT 111, 121, 122, 123, and 124.
2. Export the current cloudflared configuration from both machines.
3. Back up PostgreSQL with `pg_dump` and verify that the dump is non-empty.
4. Record the current tunnel UUIDs and their `<UUID>.cfargotunnel.com` targets.
5. Verify the recovery path before changing DNS or enabling systemd units.

Do not store API tokens, database passwords, tunnel JSON files, or populated
environment files in Git.

## 4. Prepare the containers

Use current Ubuntu LTS containers. Give CT 122 and both HostingNodes fixed
private addresses; adjust the example `10.30.30.x` / `10.20.20.x` values to the
actual networks. Permit only these flows in the Proxmox firewall:

| Source | Destination | Port | Purpose |
| --- | --- | --- | --- |
| CT 122 | CT 123 | 5432, 6379 | PostgreSQL and Redis |
| CT 122 / tunnel | CT 111 and CT 124 | 4000 | Agent API |
| CT 111 and CT 124 | CT 122/tunnel | 443 | registration, heartbeat, artifact download |
| cloudflared | CT 111 and CT 124 | 80 | public websites |

Do not expose PostgreSQL, Redis, nginx port 80, or Agent port 4000 directly to
the Internet. Cloudflare Tunnel is the public ingress.

## 5. Install the control plane (CT 122)

1. Install Node.js 20 or newer, nginx, and Git.
2. Create user `babasti`, `/opt/babasti/releases`, `/var/lib/babasti/artifacts`,
   and `/etc/babasti`; make only the required directories writable by that user.
3. Clone a pinned release into `/opt/babasti/releases/<release-id>`, run
   `npm ci`, `npx prisma generate`, and `npm run build`.
4. Copy `deploy/examples/control-plane.env.example` to
   `/etc/babasti/control-plane.env`, fill it locally, and set mode `0600`.
5. Set the client build variables before building:
   `VITE_API_URL=https://api.babasti.my.id/api` and
   `VITE_DEFAULT_DOMAIN_SUFFIX=babasti.my.id`.
6. Point `/opt/babasti/current` at the verified release.
7. Apply migrations once with `npx prisma migrate deploy`.
8. Install the example nginx and systemd files, then run `nginx -t` before
   starting the API.

The Cloudflare token must be restricted to DNS Write on the
`babasti.my.id` zone. The API fails closed in production if DNS credentials or
the selected node tunnel target are missing.

## 6. Install each HostingNode (CT 111 and CT 124)

1. Install Node.js 20 or newer, nginx, and unzip dependencies required by the
   OS. Create user `babasti-agent` in group `www-data`.
2. Create `/var/lib/babasti-agent` and `/etc/nginx/babasti-sites.d`; make both
   writable only by `babasti-agent`/the appropriate nginx group.
3. Ensure the main nginx `http` block includes
   `/etc/nginx/babasti-sites.d/*.conf`, then validate with `nginx -t`.
4. Install the same pinned application release and build it.
5. Create a unique, high-entropy `NODE_AGENT_TOKEN` on each node. Both nodes use
   the same registration-only token, which must be different from either Agent
   token.
6. Populate one local copy of `node-agent.env.example` per node:
   - CT 111: `NODE_NAME=babasti-hdd`, `PUBLIC_AGENT_URL=https://agent2...`, and
     the Proxmox 2 tunnel target.
   - CT 124: `NODE_NAME=minipc-ssd`, `PUBLIC_AGENT_URL=https://agent3...`, and
     the Proxmox 3 tunnel target.
7. Install `babasti-node-agent.service`, start it, and confirm registration plus
   recurring heartbeat in logs.

The example service runs as a dedicated user and grants only `CAP_KILL`, needed
for `nginx -s reload`. Validate this on the installed nginx build before launch;
if reload is denied, stop and fix the narrow service permission rather than
running the whole Agent as root.

## 7. Cloudflare Tunnel and DNS

Use the cloudflared examples as a mapping guide and keep the catch-all rule last.
Each HostingNode tunnel needs a wildcard ingress to its local nginx, while the
Agent hostname routes to port 4000. The control plane creates a proxied CNAME
for each customer hostname pointing to the selected node's
`<UUID>.cfargotunnel.com` target.

Before enabling automatic publishing, verify:

1. `cloudflared tunnel ingress validate` succeeds on both tunnel configs.
2. `agent2` and `agent3` return Agent health through their Access policy.
3. A temporary manual CNAME to each tunnel reaches the correct node nginx.
4. Existing DNS names have been exported. The application refuses to adopt or
   overwrite any existing CNAME and never manages reserved infrastructure
   names.

## 8. Go-live verification

Run in this order and record the output:

1. `npm run typecheck`
2. `npm run build`
3. `npm test`
4. `npx prisma validate`
5. `npx prisma generate`
6. `npx prisma migrate status`
7. API `/health`, Agent 2 `/health`, Agent 3 `/health`
8. Wrong/missing Agent token returns 403; correct node token succeeds.
9. User A cannot read, deploy, roll back, or delete User B's website.
10. Upload one small ZIP with `index.html`; confirm it becomes `ONLINE` and
    serves the expected content over HTTPS.
11. Deploy a second ZIP, then roll back; confirm the first immutable release is
    served again.
12. Drain one node and create a new website; confirm new placement goes to the
    other node while existing sites remain on their original node.
13. Stop one Agent for longer than the heartbeat TTL; confirm it becomes
    `OFFLINE` and receives no new sites.

Only after all checks pass should the dashboard be announced to clients.

## 9. Rollback

- Application release: stop the service, repoint `/opt/babasti/current` to the
  previous built release, then start and re-check health.
- Database: migrations in this repository are additive. Do not manually delete
  columns during an incident; restore the pre-rollout database backup only when
  the application rollback genuinely requires it.
- Cloudflare: restore the exported tunnel configuration/DNS records. Per-site
  records created by BabaSTI carry the comment `Managed by BabaSTI Hosting`.
- Customer website: use the product rollback action; it atomically points nginx
  at a previously successful immutable release.

## 10. Deliberate MVP limits

- Static, pre-built ZIP files only; `index.html` is required.
- No arbitrary install/build commands and no GitHub server builds.
- No PHP, Node.js, database-per-customer, email hosting, or shell access.
- No Proxmox HA, live migration, or automatic cross-node release replication.
- Node usage currently reports storage but not real bandwidth accounting.

These limits are intentional. Add container isolation, per-site resource
controls, malware scanning, backups, monitoring, and billing before offering
dynamic application hosting.
