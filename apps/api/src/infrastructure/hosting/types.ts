import type {
  WebsiteStatus,
  DeploymentStatus,
  DeploymentLogLevel,
  WebsiteUsage,
  NodeStatus,
} from "@babasti/types";

/**
 * The hosting layer is fully abstracted behind this interface. The control
 * plane (API) never talks to Proxmox or executes shell commands directly. It
 * always goes through a HostingProvider implementation. Two implementations
 * exist today: MockHostingNodeProvider (local development, no real servers)
 * and RealHostingNodeProvider (forwards to Node Agents over HTTPS).
 */

export interface HostingNode {
  id: string;
  name: string;
  status: NodeStatus;
}

export interface CreateWebsiteContext {
  websiteId: string;
  slug: string;
  defaultDomain: string;
  customDomains: string[];
  node?: HostingNode | null;
}

export interface DeployContext {
  deploymentId: string;
  websiteId: string;
  slug: string;
  defaultDomain: string;
  customDomains: string[];
  source: "ZIP" | "GITHUB";
  // For ZIP deployments the artifact is staged by the control plane.
  artifactKey?: string;
  // For GitHub deployments.
  gitRepo?: {
    name: string;
    branch: string;
    accessToken?: string | null;
  };
  build: {
    installCommand?: string | null;
    buildCommand?: string | null;
    outputDirectory?: string | null;
  };
  node?: HostingNode | null;
}

export interface DeployHooks {
  setStatus(status: DeploymentStatus): Promise<void> | void;
  log(level: DeploymentLogLevel, message: string): Promise<void> | void;
}

export interface DeployResult {
  success: boolean;
  releasePath?: string;
  releaseNumber?: number;
  message?: string;
}

export interface RollbackContext {
  websiteId: string;
  slug: string;
  defaultDomain: string;
  customDomains: string[];
  releasePath: string;
  releaseNumber: number;
  node?: HostingNode | null;
}

export interface RollbackResult {
  success: boolean;
  message?: string;
}

export interface HostingProvider {
  readonly name: string;
  createWebsite(ctx: CreateWebsiteContext): Promise<{ nodeId?: string }>;
  deployWebsite(ctx: DeployContext, hooks: DeployHooks): Promise<DeployResult>;
  rollbackWebsite(
    ctx: RollbackContext,
    hooks: DeployHooks,
  ): Promise<RollbackResult>;
  deleteWebsite(ctx: {
    websiteId: string;
    slug: string;
    nodeId?: string | null;
  }): Promise<void>;
  getWebsiteStatus(ctx: {
    websiteId: string;
    slug: string;
  }): Promise<WebsiteStatus>;
  getUsage(ctx: { websiteId: string; slug: string }): Promise<WebsiteUsage>;
}
