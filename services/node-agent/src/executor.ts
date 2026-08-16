import { promises as fs } from "node:fs";
import { createWriteStream, accessSync } from "node:fs";
import path from "node:path";
import { open as openZip, type Entry, type ZipFile } from "yauzl";
import {
  DeploymentLogLevel,
  DeploymentStatus,
  WebsiteStatus,
  type WebsiteUsage,
} from "@babasti/types";
import { loadConfig } from "@babasti/config";
import { logger } from "@babasti/shared";

/**
 * The Node Agent's execution engine. This is what actually runs ON a hosting
 * node (e.g. inside Proxmox). It performs filesystem operations, builds,
 * configures Nginx and runs health checks. It never exposes a generic shell
 * endpoint; it only exposes controlled operations invoked by the control
 * plane. The browser and control plane never touch this directly, and no
 * node credentials ever leave the node.
 */

export interface AgentDeployInput {
  deploymentId: string;
  websiteId: string;
  slug: string;
  domains: string[];
  source: "ZIP" | "GITHUB";
  artifactDownloadUrl?: string;
  nodeToken?: string;
  gitRepo?: { name: string; branch: string; accessToken?: string | null };
  build: {
    installCommand?: string | null;
    buildCommand?: string | null;
    outputDirectory?: string | null;
  };
}

export interface JobState {
  status: DeploymentStatus;
  logs: { level: DeploymentLogLevel; message: string }[];
  result?: {
    success: boolean;
    releasePath?: string;
    releaseNumber?: number;
    message?: string;
  };
}

const STEP_DELAY_MS = process.env.NODE_ENV === "test" ? 0 : 300;
const MAX_ARCHIVE_ENTRIES = 10_000;
const SAFE_SLUG = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

function delay(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((r) => setTimeout(r, ms));
}

export class NodeExecutor {
  private jobs = new Map<string, JobState>();
  private root: string;
  private nginxConfigDir: string;
  private nginxBinary: string;
  private requireSystemNginx: boolean;

  constructor() {
    const config = loadConfig();
    this.root = path.resolve(config.agentStoragePath, "sites");
    this.nginxConfigDir = config.AGENT_NGINX_CONFIG_DIR
      ? path.resolve(config.AGENT_NGINX_CONFIG_DIR)
      : "";
    this.nginxBinary = config.AGENT_NGINX_BINARY;
    this.requireSystemNginx =
      config.NODE_ENV === "production" && config.DEPLOYMENT_PROVIDER === "real";
  }

  private siteRoot(slug: string): string {
    if (!SAFE_SLUG.test(slug)) throw new Error("invalid website slug");
    const target = path.resolve(this.root, slug);
    if (!target.startsWith(`${this.root}${path.sep}`)) {
      throw new Error("website path escapes storage root");
    }
    return target;
  }

  private releaseDir(slug: string, num: number): string {
    return path.join(this.siteRoot(slug), "releases", String(num));
  }

  private currentLink(slug: string): string {
    return path.join(this.siteRoot(slug), "current");
  }

  createWebsite(input: {
    websiteId: string;
    slug: string;
    domains: string[];
  }): { nodeId: string } {
    void fs.mkdir(this.siteRoot(input.slug), { recursive: true });
    return { nodeId: `agent-${input.websiteId}` };
  }

  async deleteWebsite(input: {
    websiteId: string;
    slug: string;
  }): Promise<void> {
    await fs.rm(this.siteRoot(input.slug), { recursive: true, force: true });
    if (this.nginxConfigDir) {
      await fs.rm(this.systemNginxConfig(input.slug), { force: true });
      if (!(await validateSystemNginx(this.nginxBinary))) {
        throw new Error("nginx validation failed after website removal");
      }
      await reloadSystemNginx(this.nginxBinary);
    }
  }

  getStatus(slug: string): WebsiteStatus {
    const link = this.currentLink(slug);
    try {
      accessSync(link);
      return "ONLINE";
    } catch {
      return "OFFLINE";
    }
  }

  async getUsage(slug: string): Promise<WebsiteUsage> {
    let bytes = 0;
    const walk = async (dir: string): Promise<void> => {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) await walk(full);
        else if (e.isFile()) bytes += (await fs.stat(full)).size;
      }
    };
    try {
      await walk(this.siteRoot(slug));
    } catch {
      bytes = 0;
    }
    return { storageBytes: bytes, bandwidthBytes: 0, deploymentsCount: 0 };
  }

  getJob(deploymentId: string): JobState {
    return (
      this.jobs.get(deploymentId) ?? {
        status: DeploymentStatus.FAILED,
        logs: [{ level: "ERROR", message: "Job state not found" }],
        result: { success: false, message: "job lost" },
      }
    );
  }

  /** Begin processing a deployment asynchronously. */
  startDeploy(input: AgentDeployInput): void {
    const state: JobState = { status: DeploymentStatus.QUEUED, logs: [] };
    this.jobs.set(input.deploymentId, state);
    void this.runDeploy(input, state);
  }

  private async runDeploy(
    input: AgentDeployInput,
    state: JobState,
  ): Promise<void> {
    const log = (level: DeploymentLogLevel, message: string) => {
      state.logs.push({ level, message });
    };
    const setStatus = (status: DeploymentStatus) => {
      state.status = status;
    };
    const slug = input.slug;
    const root = this.siteRoot(slug);
    try {
      if (input.source !== "ZIP") {
        log("ERROR", "GitHub deployments require the sandboxed build runner");
        setStatus(DeploymentStatus.FAILED);
        state.result = {
          success: false,
          message: "GitHub deployments are not enabled on this node",
        };
        return;
      }
      if (input.build.buildCommand || input.build.installCommand) {
        log("ERROR", "Server-side build commands require the sandboxed build runner");
        setStatus(DeploymentStatus.FAILED);
        state.result = {
          success: false,
          message: "server-side builds are not enabled on this node",
        };
        return;
      }
      await fs.mkdir(root, { recursive: true });
      const releasesPath = path.join(root, "releases");
      await fs.mkdir(releasesPath, { recursive: true });
      const existing = (await fs.readdir(releasesPath)).map((n) =>
        Number.parseInt(n, 10),
      ).filter(Number.isFinite);
      const releaseNumber = (existing.length ? Math.max(...existing) : 1000) + 1;
      const target = this.releaseDir(slug, releaseNumber);

      log("INFO", `Preparing deployment ${input.deploymentId}`);
      setStatus(DeploymentStatus.PREPARING);
      await delay(STEP_DELAY_MS);

      if (input.source === "ZIP") {
        setStatus(DeploymentStatus.UPLOADING);
        log("INFO", "Downloading artifact from control plane");
        if (!input.artifactDownloadUrl || !input.nodeToken) {
          log("ERROR", "Missing artifact source");
          setStatus(DeploymentStatus.FAILED);
          state.result = { success: false, message: "missing artifact" };
          return;
        }
        const res = await fetch(input.artifactDownloadUrl, {
          headers: artifactDownloadHeaders(input.nodeToken),
          signal: AbortSignal.timeout(30_000),
        });
        if (!res.ok) {
          log("ERROR", `Artifact download failed (${res.status})`);
          setStatus(DeploymentStatus.FAILED);
          state.result = { success: false, message: "artifact download failed" };
          return;
        }
        const buffer = Buffer.from(await res.arrayBuffer());
        const staging = path.join(root, "tmp", `${input.deploymentId}.zip`);
        await fs.mkdir(path.dirname(staging), { recursive: true });
        await fs.writeFile(staging, buffer);
        log("INFO", `Archive received (${buffer.byteLength} bytes)`);
        await delay(STEP_DELAY_MS);
        log("INFO", "Extracting files");
        await extractZipSafe(staging, target);
        await fs.rm(staging, { force: true });
      }

      const entries = await fs.readdir(target).catch(() => [] as string[]);
      if (!entries.includes("index.html")) {
        const out = input.build.outputDirectory;
        if (out) {
          const built = path.resolve(target, out);
          if (!built.startsWith(`${path.resolve(target)}${path.sep}`)) {
            throw new Error("publish directory escapes release root");
          }
          const builtEntries = await fs
            .readdir(built)
            .catch(() => [] as string[]);
          if (builtEntries.includes("index.html")) {
            await moveContents(built, target);
          }
        }
        if (!(await fs.readdir(target).catch(() => [] as string[])).includes("index.html")) {
          log("ERROR", "No index.html found in the publish directory");
          setStatus(DeploymentStatus.FAILED);
          state.result = {
            success: false,
            message: "publish directory must contain index.html",
          };
          return;
        }
      } else {
        log("INFO", "Build output validated");
      }

      setStatus(DeploymentStatus.PUBLISHING);
      log("INFO", `Publishing release ${releaseNumber}`);
      await delay(STEP_DELAY_MS);

      setStatus(DeploymentStatus.CONFIGURING);
      const valid = await this.installRouting(slug, input.domains);
      if (!valid) {
        log("ERROR", "Nginx config validation failed");
        setStatus(DeploymentStatus.FAILED);
        state.result = { success: false, message: "nginx invalid" };
        return;
      }

      setStatus(DeploymentStatus.HEALTH_CHECK);
      log("INFO", "Health check");
      if (!(await fs.readdir(target)).length) {
        log("ERROR", "Health check failed");
        setStatus(DeploymentStatus.FAILED);
        state.result = { success: false, message: "health check failed" };
        return;
      }

      const liveLink = this.currentLink(slug);
      const previousTarget = await fs.readlink(liveLink).catch(() => null);
      await createSymlink(target, liveLink);
      if (!(await this.healthCheck(input.domains[0], target))) {
        if (previousTarget) await createSymlink(previousTarget, liveLink);
        else await fs.rm(liveLink, { force: true });
        log("ERROR", "Published website did not pass its live health check");
        setStatus(DeploymentStatus.FAILED);
        state.result = { success: false, message: "live health check failed" };
        return;
      }
      log("INFO", "Deployment successful");
      setStatus(DeploymentStatus.SUCCESS);
      state.result = {
        success: true,
        releasePath: path.relative(root, target) || target,
        releaseNumber,
      };
    } catch (error) {
      log("ERROR", `Deployment failed: ${(error as Error).message}`);
      setStatus(DeploymentStatus.FAILED);
      state.result = { success: false, message: (error as Error).message };
    }
  }

  async startRollback(input: {
    websiteId: string;
    slug: string;
    domains: string[];
    releasePath: string;
    releaseNumber: number;
  }): Promise<{ success: boolean; message?: string }> {
    const root = this.siteRoot(input.slug);
    const target = path.resolve(root, input.releasePath);
    const expected = path.resolve(this.releaseDir(input.slug, input.releaseNumber));
    if (target !== expected) {
      return { success: false, message: "invalid release path" };
    }
    try {
      await fs.access(target);
      const valid = await this.installRouting(input.slug, input.domains);
      if (!valid) return { success: false, message: "nginx invalid" };
      const liveLink = this.currentLink(input.slug);
      const previousTarget = await fs.readlink(liveLink).catch(() => null);
      await createSymlink(target, liveLink);
      if (!(await this.healthCheck(input.domains[0], target))) {
        if (previousTarget) await createSymlink(previousTarget, liveLink);
        else await fs.rm(liveLink, { force: true });
        return { success: false, message: "live health check failed" };
      }
      return { success: true };
    } catch (error) {
      return { success: false, message: (error as Error).message };
    }
  }

  private systemNginxConfig(slug: string): string {
    return path.join(this.nginxConfigDir, `babasti-${slug}.conf`);
  }

  private async installRouting(slug: string, domains: string[]): Promise<boolean> {
    const root = this.siteRoot(slug);
    const configPath = path.join(root, "nginx.conf");
    const nginx = buildNginx(domains, this.currentLink(slug));
    await fs.writeFile(configPath, nginx);
    if (!(await validateNginx(configPath))) return false;

    if (!this.nginxConfigDir) {
      if (this.requireSystemNginx) {
        logger.error("AGENT_NGINX_CONFIG_DIR is required in production real mode");
        return false;
      }
      logger.warn("System nginx publishing disabled (development mode)");
      return true;
    }

    await fs.mkdir(this.nginxConfigDir, { recursive: true });
    const destination = this.systemNginxConfig(slug);
    const temporary = `${destination}.tmp-${process.pid}-${Date.now()}`;
    const previous = await fs.readFile(destination).catch(() => null);
    await fs.writeFile(temporary, nginx, { flag: "wx" });
    await fs.rename(temporary, destination);

    if (!(await validateSystemNginx(this.nginxBinary))) {
      if (previous) await fs.writeFile(destination, previous);
      else await fs.rm(destination, { force: true });
      return false;
    }
    try {
      await reloadSystemNginx(this.nginxBinary);
      return true;
    } catch (error) {
      if (previous) await fs.writeFile(destination, previous);
      else await fs.rm(destination, { force: true });
      logger.error("nginx reload failed", error);
      return false;
    }
  }

  private async healthCheck(domain: string | undefined, target: string): Promise<boolean> {
    if (!this.nginxConfigDir) {
      return fs.readdir(target).then((entries) => entries.length > 0).catch(() => false);
    }
    if (!domain) return false;
    try {
      const response = await fetch("http://127.0.0.1/", {
        headers: { host: domain },
        redirect: "manual",
        signal: AbortSignal.timeout(10_000),
      });
      return response.status >= 200 && response.status < 400;
    } catch {
      return false;
    }
  }
}

// ---------- fs helpers (self-contained) ----------

function normalizeEntryName(name: string): string | null {
  const trimmed = name.replace(/\\/g, "/");
  if (trimmed.startsWith("/") || trimmed.includes("\0")) return null;
  const parts = trimmed.split("/").filter(Boolean);
  let depth = 0;
  for (const p of parts) {
    if (p === ".") continue;
    if (p === "..") {
      depth -= 1;
      if (depth < 0) return null;
    } else depth += 1;
  }
  return parts.join("/");
}

async function extractZipSafe(zipPath: string, targetDir: string): Promise<void> {
  await fs.mkdir(targetDir, { recursive: true });
  const resolvedTarget = path.resolve(targetDir);
  await new Promise<void>((resolve, reject) => {
    openZip(zipPath, { lazyEntries: true }, (err, zipfile) => {
      if (err || !zipfile) return reject(err ?? new Error("open failed"));
      const onErr = (e: unknown) => {
        zipfile.close();
        reject(e);
      };
      zipfile.on("error", onErr);
      zipfile.on("end", () => {
        zipfile.close();
        resolve();
      });
      zipfile.readEntry();
      let entries = 0;
      let extractedBytes = 0;
      zipfile.on("entry", (entry: Entry) => {
        entries += 1;
        extractedBytes += entry.uncompressedSize;
        if (
          entries > MAX_ARCHIVE_ENTRIES ||
          extractedBytes > loadConfig().MAX_EXTRACTED_BYTES
        ) {
          return onErr(new Error("archive extraction limit exceeded"));
        }
        const name = normalizeEntryName(entry.fileName);
        if (!name) return onErr(new Error(`unsafe entry ${entry.fileName}`));
        const dest = path.join(resolvedTarget, name);
        if (
          dest !== resolvedTarget &&
          !dest.startsWith(`${resolvedTarget}${path.sep}`)
        )
          return onErr(new Error("entry escapes target"));
        if (entry.fileName.endsWith("/")) {
          fs.mkdir(dest, { recursive: true })
            .then(() => zipfile.readEntry())
            .catch(onErr);
          return;
        }
        fs.mkdir(path.dirname(dest), { recursive: true })
          .then(
            () =>
              new Promise<void>((res, rej) => {
                zipfile.openReadStream(entry, (se, stream) => {
                  if (se || !stream) return rej(se ?? new Error("read failed"));
                  const out = createWriteStream(dest);
                  stream.on("error", rej);
                  out.on("error", rej);
                  out.on("finish", res);
                  stream.pipe(out);
                });
              }),
          )
          .then(() => zipfile.readEntry())
          .catch(onErr);
      });
    });
  });
}

async function moveContents(from: string, to: string): Promise<void> {
  const entries = await fs.readdir(from, { withFileTypes: true });
  for (const e of entries) {
    if (e.name === "." || e.name === "..") continue;
    await fs.rename(path.join(from, e.name), path.join(to, e.name));
  }
}

async function createSymlink(target: string, link: string): Promise<void> {
  // On Windows, directory symlinks require elevated privileges whereas a
  // junction does not, so use a junction there. On other platforms the
  // directory symlink type is correct.
  const type: "dir" | "junction" =
    process.platform === "win32" ? "junction" : "dir";
  const temporary = `${link}.tmp-${process.pid}-${Date.now()}`;
  await fs.rm(temporary, { recursive: true, force: true });
  await fs.symlink(target, temporary, type);
  try {
    // POSIX rename replaces the old symlink atomically, so nginx never sees a
    // missing `current` path.
    await fs.rename(temporary, link);
  } catch (error) {
    if (process.platform !== "win32") {
      await fs.rm(temporary, { recursive: true, force: true });
      throw error;
    }
    // Windows cannot replace an existing junction with rename. This fallback
    // is used by local verification only; production nodes are Linux.
    await fs.rm(link, { recursive: true, force: true });
    await fs.rename(temporary, link);
  }
}

function escapeNginx(value: string): string {
  return value.replace(/["\\$]/g, "\\$&");
}

function buildNginx(domains: string[], root: string): string {
  const serverName = domains.map((d) => `"${escapeNginx(d)}"`).join(" ");
  return [
    "server {",
    "    listen 80;",
    `    server_name ${serverName};`,
    `    root ${escapeNginx(root)};`,
    "    index index.html;",
    "    location / { try_files $uri $uri/ /index.html; }",
    "}",
    "",
  ].join("\n");
}

export function rewriteNginxForValidation(
  nginx: string,
  port: number,
): string {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error("invalid nginx validation port");
  }
  return nginx.replace(
    /(^\s*listen\s+)80(\s*;)/gm,
    (_match, prefix: string, suffix: string) =>
      `${prefix}127.0.0.1:${port}${suffix}`,
  );
}

async function validateNginx(configPath: string): Promise<boolean> {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const run = promisify(execFile);

  // The site config is a `server {}` snippet meant to be included by the
  // host's main nginx (sites-enabled/*). `nginx -t -c <file>` treats the file
  // as the MAIN config, which requires an `http {}` wrapper and fails on a
  // bare `server` block. Validate the snippet by wrapping it in a temporary
  // full config that includes it — this matches real-world usage.
  const dir = path.dirname(configPath);
  const wrapper = path.join(dir, "_nginxtest.conf");
  const validationSnippet = path.join(dir, "_nginxtest-site.conf");
  const pidFile = path.join(dir, "_nginxtest.pid");
  const errLog = path.join(dir, "_nginxtest_error.log");
  const tempDir = path.join(dir, "_nginxtemp");
  // nginx -t opens listening sockets while validating a standalone config.
  // The Agent intentionally runs without root privileges, so validate the
  // generated snippet on an unprivileged loopback port. The installed site
  // config keeps its real `listen 80` directive and is validated again as
  // part of the host's main nginx configuration before reload.
  const validationPort = 49152 + (process.pid % 15000);
  const config = await fs.readFile(configPath, "utf8");
  await fs.writeFile(
    validationSnippet,
    rewriteNginxForValidation(config, validationPort),
  );
  await fs.mkdir(tempDir, { recursive: true });
  await fs.writeFile(
    wrapper,
    [
      `error_log ${JSON.stringify(errLog)};`,
      `pid ${JSON.stringify(pidFile)};`,
      "events { worker_connections 1024; }",
      "http {",
      `    client_body_temp_path ${JSON.stringify(tempDir)};`,
      `    proxy_temp_path ${JSON.stringify(tempDir)};`,
      `    fastcgi_temp_path ${JSON.stringify(tempDir)};`,
      `    uwsgi_temp_path ${JSON.stringify(tempDir)};`,
      `    scgi_temp_path ${JSON.stringify(tempDir)};`,
      "    access_log off;",
      `    include ${JSON.stringify(validationSnippet)};`,
      "}",
      "",
    ].join("\n"),
  );

  try {
    await run("nginx", ["-t", "-c", wrapper]);
    return true;
  } catch (error) {
    const err = error as { message?: string; code?: string };
    const msg = err.message ?? String(error);
    const missing =
      /command not found/i.test(msg) ||
      /not found/i.test(msg) ||
      /ENOENT/i.test(msg) ||
      /spawn/i.test(msg) ||
      err.code === "ENOENT";
    if (missing) {
      if (process.env.NODE_ENV === "production") return false;
      logger.warn("nginx -t unavailable; skipping validation (dev)");
      return true;
    }
    logger.error("nginx validation failed", msg);
    return false;
  } finally {
    for (const f of [wrapper, validationSnippet, pidFile, errLog, tempDir]) {
      try {
        await fs.rm(f, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  }
}

async function validateSystemNginx(binary: string): Promise<boolean> {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  try {
    await promisify(execFile)(binary, ["-t"]);
    return true;
  } catch (error) {
    logger.error("system nginx validation failed", error);
    return false;
  }
}

async function reloadSystemNginx(binary: string): Promise<void> {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  await promisify(execFile)(binary, ["-s", "reload"]);
}

function artifactDownloadHeaders(nodeToken: string): Record<string, string> {
  const config = loadConfig();
  const headers: Record<string, string> = {
    authorization: `Bearer ${nodeToken}`,
  };
  if (
    config.CLOUDFLARE_ACCESS_CLIENT_ID &&
    config.CLOUDFLARE_ACCESS_CLIENT_SECRET
  ) {
    headers["CF-Access-Client-Id"] = config.CLOUDFLARE_ACCESS_CLIENT_ID;
    headers["CF-Access-Client-Secret"] =
      config.CLOUDFLARE_ACCESS_CLIENT_SECRET;
  }
  return headers;
}
