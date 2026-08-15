import { promises as fs } from "node:fs";
import path from "node:path";
import {
  DeploymentLogLevel,
  type DeploymentStatus,
  type WebsiteStatus,
  type WebsiteUsage,
} from "@babasti/types";
import { logger } from "@babasti/shared";
import type {
  DeployContext,
  DeployHooks,
  DeployResult,
  HostingProvider,
  CreateWebsiteContext,
  RollbackContext,
  RollbackResult,
} from "./types.js";
import {
  extractZipSafe,
  releaseDir,
  currentLink,
  siteRoot,
  buildNginxConfig,
  validateNginxConfig,
} from "./zip-utils.js";
import { getStorage } from "../storage/index.js";

const STEP_DELAY_MS = process.env.NODE_ENV === "test" ? 0 : 350;

async function delay(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function safeSymlink(target: string, link: string): Promise<void> {
  try {
    await fs.unlink(link);
  } catch {
    /* ignore */
  }
  // On Windows, directory symlinks require elevated privileges, whereas a
  // junction does not — so use a junction there. On other platforms the
  // directory symlink type is correct.
  const type: "dir" | "junction" =
    process.platform === "win32" ? "junction" : "dir";
  await fs.symlink(target, link, type);
}

export class MockHostingNodeProvider implements HostingProvider {
  readonly name = "mock";

  async createWebsite(_ctx: CreateWebsiteContext): Promise<{ nodeId?: string }> {
    // The mock provider maintains a synthetic node so the rest of the system
    // can reason about node assignment uniformly.
    return { nodeId: "mock-node" };
  }

  async deployWebsite(
    ctx: DeployContext,
    hooks: DeployHooks,
  ): Promise<DeployResult> {
    const root = siteRoot(ctx.slug);
    await fs.mkdir(root, { recursive: true });

    const releasesPath = path.join(root, "releases");
    await fs.mkdir(releasesPath, { recursive: true });
    const existing = await fs.readdir(releasesPath);
    const numbers = existing
      .map((name) => Number.parseInt(name, 10))
      .filter((n) => Number.isFinite(n));
    const releaseNumber = (numbers.length ? Math.max(...numbers) : 1000) + 1;
    const target = releaseDir(ctx.slug, releaseNumber);

    const log = async (level: DeploymentLogLevel, message: string) =>
      hooks.log(level, message);
    const setStatus = async (status: DeploymentStatus) =>
      hooks.setStatus(status);

    try {
      await log("INFO", `Preparing deployment ${ctx.deploymentId}`);
      await setStatus("PREPARING");
      await delay(STEP_DELAY_MS);

      if (ctx.source === "ZIP") {
        await setStatus("UPLOADING");
        await log("INFO", "Receiving uploaded archive");
        if (!ctx.artifactKey) {
          await log("ERROR", "Missing artifact for ZIP deployment");
          await setStatus("FAILED");
          return { success: false, message: "Missing artifact" };
        }
        const buffer = await getStorage().readArtifact(ctx.artifactKey);
        const staging = path.join(root, "tmp", ctx.deploymentId + ".zip");
        await fs.mkdir(path.dirname(staging), { recursive: true });
        await fs.writeFile(staging, buffer);
        await log("INFO", `Archive received (${buffer.byteLength} bytes)`);
        await delay(STEP_DELAY_MS);

        await log("INFO", "Extracting files");
        await extractZipSafe(staging, target);
        await fs.rm(staging, { force: true });
        await log("INFO", "Validating project structure");
        await delay(STEP_DELAY_MS);
      } else {
        await setStatus("CLONING");
        await log(
          "INFO",
          `Cloning ${ctx.gitRepo?.name ?? "repository"} (${ctx.gitRepo?.branch ?? "main"})`,
        );
        await delay(STEP_DELAY_MS * 2);
        await log("INFO", "Repository cloned");
      }

      // Build phase (simulated for the mock provider).
      if (ctx.build.buildCommand) {
        await setStatus("INSTALLING");
        await log("INFO", `Running: ${ctx.build.installCommand ?? "npm install"}`);
        await delay(STEP_DELAY_MS);
        await setStatus("BUILDING");
        await log("INFO", `Running: ${ctx.build.buildCommand}`);
        await delay(STEP_DELAY_MS);
      }

      // Ensure there is content to serve.
      const entries = await fs.readdir(target).catch(() => [] as string[]);
      const hasIndex = entries.includes("index.html");
      if (!hasIndex) {
        const outDir = ctx.build.outputDirectory;
        const builtPath = outDir ? path.join(target, outDir) : target;
        const builtEntries = await fs
          .readdir(builtPath)
          .catch(() => [] as string[]);
        if (builtEntries.includes("index.html")) {
          // output directory contains the build; move contents up.
          await moveContents(builtPath, target);
        } else {
          await fs.writeFile(
            path.join(target, "index.html"),
            renderPlaceholder(ctx),
          );
          await log(
            "WARN",
            "No index.html found, served a generated placeholder",
          );
        }
      } else {
        await log("INFO", "Build output validated");
      }
      await delay(STEP_DELAY_MS);

      await setStatus("PUBLISHING");
      await log("INFO", `Publishing release ${releaseNumber}`);
      await delay(STEP_DELAY_MS);

      await setStatus("CONFIGURING");
      await log("INFO", "Writing routing configuration");
      const ngx = buildNginxConfig({
        domains: [ctx.defaultDomain, ...ctx.customDomains],
        root: path.join(target),
      });
      await fs.writeFile(path.join(root, "nginx.conf"), ngx);
      const valid = await validateNginxConfig(path.join(root, "nginx.conf"));
      if (!valid) {
        await log("ERROR", "Routing configuration validation failed");
        await setStatus("FAILED");
        return { success: false, message: "nginx config invalid" };
      }
      await delay(STEP_DELAY_MS);

      await setStatus("HEALTH_CHECK");
      await log("INFO", "Performing health check");
      const healthy = await this.healthCheckFs(target);
      if (!healthy) {
        await log("ERROR", "Health check failed");
        await setStatus("FAILED");
        return { success: false, message: "health check failed" };
      }
      await delay(STEP_DELAY_MS);

      // Atomic switch to the new release.
      await log("INFO", "Switching live release");
      await safeSymlink(target, currentLink(ctx.slug));
      await log("INFO", "Deployment successful");
      await setStatus("SUCCESS");

      return {
        success: true,
        releasePath: path.relative(root, target) || target,
        releaseNumber,
      };
    } catch (error) {
      await log("ERROR", `Deployment failed: ${(error as Error).message}`);
      await setStatus("FAILED");
      return { success: false, message: (error as Error).message };
    }
  }

  async rollbackWebsite(
    ctx: RollbackContext,
    hooks: DeployHooks,
  ): Promise<RollbackResult> {
    const root = siteRoot(ctx.slug);
    const target = path.join(root, ctx.releasePath);
    const log = async (level: DeploymentLogLevel, message: string) =>
      hooks.log(level, message);
    try {
      await log("INFO", `Rolling back to release ${ctx.releaseNumber}`);
      await log("INFO", "Validating target release");
      const exists = await fs
        .access(target)
        .then(() => true)
        .catch(() => false);
      if (!exists) {
        await log("ERROR", "Target release no longer exists");
        return { success: false, message: "release missing" };
      }
      await delay(STEP_DELAY_MS);
      await log("INFO", "Rewriting routing configuration");
      const ngx = buildNginxConfig({
        domains: [ctx.defaultDomain, ...ctx.customDomains],
        root: target,
      });
      await fs.writeFile(path.join(root, "nginx.conf"), ngx);
      const valid = await validateNginxConfig(path.join(root, "nginx.conf"));
      if (!valid) {
        await log("ERROR", "Routing configuration validation failed");
        return { success: false, message: "nginx config invalid" };
      }
      await log("INFO", "Performing health check");
      if (!(await this.healthCheckFs(target))) {
        await log("ERROR", "Health check failed");
        return { success: false, message: "health check failed" };
      }
      await safeSymlink(target, currentLink(ctx.slug));
      await log("INFO", "Rollback successful");
      return { success: true };
    } catch (error) {
      await log("ERROR", `Rollback failed: ${(error as Error).message}`);
      return { success: false, message: (error as Error).message };
    }
  }

  async deleteWebsite(ctx: {
    websiteId: string;
    slug: string;
    nodeId?: string | null;
  }): Promise<void> {
    await fs.rm(siteRoot(ctx.slug), { recursive: true, force: true });
    logger.info(`[mock] removed site ${ctx.slug}`);
  }

  async getWebsiteStatus(_ctx: {
    websiteId: string;
    slug: string;
  }): Promise<WebsiteStatus> {
    const root = siteRoot(_ctx.slug);
    const link = currentLink(_ctx.slug);
    const exists = await fs
      .access(link)
      .then(() => true)
      .catch(() => false);
    return exists ? "ONLINE" : "OFFLINE";
  }

  async getUsage(_ctx: {
    websiteId: string;
    slug: string;
  }): Promise<WebsiteUsage> {
    // Best-effort disk usage estimate.
    const root = siteRoot(_ctx.slug);
    let bytes = 0;
    try {
      const walk = async (dir: string): Promise<void> => {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) await walk(full);
          else if (entry.isFile()) {
            const stat = await fs.stat(full);
            bytes += stat.size;
          }
        }
      };
      await walk(root);
    } catch {
      bytes = 0;
    }
    return {
      storageBytes: bytes,
      bandwidthBytes: 0,
      deploymentsCount: 0,
    };
  }

  private async healthCheckFs(target: string): Promise<boolean> {
    try {
      const entries = await fs.readdir(target);
      return entries.length > 0;
    } catch {
      return false;
    }
  }
}

async function moveContents(from: string, to: string): Promise<void> {
  const entries = await fs.readdir(from, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === "." || entry.name === "..") continue;
    await fs.rename(path.join(from, entry.name), path.join(to, entry.name));
  }
}

function renderPlaceholder(ctx: DeployContext): string {
  const source =
    ctx.source === "GITHUB"
      ? `GitHub: ${ctx.gitRepo?.name ?? "unknown"}@${ctx.gitRepo?.branch ?? "main"}`
      : "ZIP upload";
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>${ctx.slug}</title></head>
<body style="font-family:system-ui;max-width:640px;margin:12vh auto;padding:0 24px;color:#0f172a">
  <h1>${ctx.slug}.babasti.my.id</h1>
  <p>Your site <strong>${ctx.slug}</strong> is live on BabaSTI Hosting.</p>
  <p style="color:#475569">Source: ${source}</p>
</body>
</html>`;
}
