import {
  DeploymentLogLevel,
  type DeploymentStatus,
  type WebsiteStatus,
  type WebsiteUsage,
} from "@babasti/types";
import type { HostingNode } from "./types.js";
import { loadConfig } from "@babasti/config";
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

/**
 * Real provider: dispatches deployment work to a Hosting Node Agent over
 * HTTPS. The control plane NEVER touches Proxmox or runs shell commands. All
 * execution happens on the agent, which authenticates using NODE_AGENT_TOKEN.
 *
 * The agent reports progress by calling back into the control plane's internal
 * API (used by deployWebsite hooks). Here we also poll the agent for the
 * terminal state as a fallback. Node selection is delegated to the scheduler.
 */

interface AgentLogEntry {
  level: DeploymentLogLevel;
  message: string;
}

interface AgentJobStatus {
  status: DeploymentStatus;
  success: boolean;
  message?: string;
  releasePath?: string;
  releaseNumber?: number;
  logs?: AgentLogEntry[];
}

export class RealHostingNodeProvider implements HostingProvider {
  readonly name = "real";
  private baseUrl: string;
  private token: string;

  constructor() {
    const config = loadConfig();
    const url = config.NODE_AGENT_URL;
    if (!url) {
      throw new Error("NODE_AGENT_URL is required for the real provider");
    }
    this.baseUrl = url.replace(/\/$/, "");
    this.token = config.NODE_AGENT_TOKEN;
  }

  private headers(): Record<string, string> {
    return {
      "content-type": "application/json",
      authorization: `Bearer ${this.token}`,
    };
  }

  async createWebsite(ctx: CreateWebsiteContext): Promise<{ nodeId?: string }> {
    if (!ctx.node) throw new Error("No hosting node available");
    const res = await fetch(`${this.baseUrl}/v1/websites`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        websiteId: ctx.websiteId,
        slug: ctx.slug,
        domains: [ctx.defaultDomain, ...ctx.customDomains],
      }),
    });
    if (!res.ok) {
      throw new Error(`Node agent createWebsite failed: ${res.status}`);
    }
    const data = (await res.json()) as { nodeId: string };
    return { nodeId: data.nodeId ?? ctx.node.id };
  }

  async deployWebsite(
    ctx: DeployContext,
    hooks: DeployHooks,
  ): Promise<DeployResult> {
    if (!ctx.node) throw new Error("No hosting node available");
    const payload = {
      deploymentId: ctx.deploymentId,
      websiteId: ctx.websiteId,
      slug: ctx.slug,
      domains: [ctx.defaultDomain, ...ctx.customDomains],
      source: ctx.source,
      artifactKey: ctx.artifactKey,
      artifactDownloadUrl: ctx.artifactKey
        ? `${this.controlPlaneUrl()}/internal/artifacts/${ctx.artifactKey}`
        : undefined,
      nodeToken: this.token,
      gitRepo: ctx.gitRepo,
      build: ctx.build,
    };
    const res = await fetch(`${this.baseUrl}/v1/deployments`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(payload),
      // Don't block forever if the node is unreachable/hung (spec §19).
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      await hooks.log("ERROR", `Node agent rejected job (${res.status})`);
      await hooks.setStatus("FAILED");
      return { success: false, message: "agent rejected job" };
    }
    return this.poll(ctx.deploymentId, ctx.node, hooks);
  }

  private async poll(
    deploymentId: string,
    _node: HostingNode,
    hooks: DeployHooks,
  ): Promise<DeployResult> {
    const deadline = Date.now() + 1000 * 60 * 15; // 15 min
    const seenStatus = new Set<DeploymentStatus>();
    let logCursor = 0;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 2000));
      let status: AgentJobStatus;
      try {
        const res = await fetch(
          `${this.baseUrl}/v1/deployments/${deploymentId}`,
          { headers: this.headers(), signal: AbortSignal.timeout(10_000) },
        );
        if (!res.ok) {
          logger.warn(`Agent status poll failed: ${res.status}`);
          continue;
        }
        status = (await res.json()) as AgentJobStatus;
      } catch (error) {
        logger.warn(`Agent poll error: ${(error as Error).message}`);
        continue;
      }
      if (Array.isArray(status.logs)) {
        for (; logCursor < status.logs.length; logCursor++) {
          const entry = status.logs[logCursor];
          await hooks.log(entry.level, entry.message);
        }
      }
      if (
        status.status !== "SUCCESS" &&
        status.status !== "FAILED" &&
        status.status !== "CANCELLED"
      ) {
        if (!seenStatus.has(status.status)) {
          seenStatus.add(status.status);
          await hooks.setStatus(status.status);
        }
      }
      if (status.status === "SUCCESS") {
        await hooks.setStatus("SUCCESS");
        return {
          success: true,
          releasePath: status.releasePath,
          releaseNumber: status.releaseNumber,
        };
      }
      if (status.status === "FAILED" || status.status === "CANCELLED") {
        await hooks.setStatus(status.status);
        return { success: false, message: status.message };
      }
    }
    await hooks.setStatus("FAILED");
    return { success: false, message: "deployment timed out" };
  }

  private controlPlaneUrl(): string {
    const url = process.env.CONTROL_PLANE_URL || "http://localhost:3000";
    return url.replace(/\/$/, "");
  }

  async rollbackWebsite(
    ctx: RollbackContext,
    hooks: DeployHooks,
  ): Promise<RollbackResult> {
    if (!ctx.node) return { success: false, message: "No hosting node" };
    const res = await fetch(`${this.baseUrl}/v1/rollbacks`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        websiteId: ctx.websiteId,
        slug: ctx.slug,
        domains: [ctx.defaultDomain, ...ctx.customDomains],
        releasePath: ctx.releasePath,
        releaseNumber: ctx.releaseNumber,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      await hooks.log("ERROR", `Agent rollback failed (${res.status})`);
      return { success: false, message: "agent rollback failed" };
    }
    const data = (await res.json()) as RollbackResult;
    return data;
  }

  async deleteWebsite(ctx: {
    websiteId: string;
    slug: string;
    nodeId?: string | null;
  }): Promise<void> {
    const res = await fetch(
      `${this.createUrl()}/v1/websites/${ctx.websiteId}`,
      { method: "DELETE", headers: this.headers(), signal: AbortSignal.timeout(30_000) },
    );
    if (!res.ok) {
      logger.warn(`Agent delete failed: ${res.status}`);
    }
  }

  private createUrl(): string {
    return this.baseUrl;
  }

  async getWebsiteStatus(_ctx: {
    websiteId: string;
    slug: string;
  }): Promise<WebsiteStatus> {
    try {
      const res = await fetch(
        `${this.baseUrl}/v1/websites/${_ctx.websiteId}/status`,
        { headers: this.headers() },
      );
      if (!res.ok) return "OFFLINE";
      const data = (await res.json()) as { status: WebsiteStatus };
      return data.status;
    } catch {
      return "OFFLINE";
    }
  }

  async getUsage(_ctx: {
    websiteId: string;
    slug: string;
  }): Promise<WebsiteUsage> {
    try {
      const res = await fetch(
        `${this.baseUrl}/v1/websites/${_ctx.websiteId}/usage`,
        { headers: this.headers() },
      );
      if (!res.ok) return { storageBytes: 0, bandwidthBytes: 0, deploymentsCount: 0 };
      return (await res.json()) as WebsiteUsage;
    } catch {
      return { storageBytes: 0, bandwidthBytes: 0, deploymentsCount: 0 };
    }
  }
}
