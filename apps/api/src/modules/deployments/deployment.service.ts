import { prisma } from "../../infrastructure/database/prisma.js";
import { getHostingProvider } from "../../infrastructure/hosting/index.js";
import { assertNodeAvailable, chooseNode } from "../../infrastructure/hosting/scheduler.js";
import { getStorage } from "../../infrastructure/storage/index.js";
import { getQueue } from "../../infrastructure/queue/index.js";
import {
  DeploymentLogLevel,
  DeploymentStatus,
  WebsiteStatus,
} from "@babasti/types";
import type { HostingNode } from "../../infrastructure/hosting/types.js";
import { AppError, ErrorCode, generateId, logger } from "@babasti/shared";
import type { DeployContext, DeployHooks } from "../../infrastructure/hosting/types.js";
import { isRejectableTransition } from "../../infrastructure/hosting/state-machine.js";

async function appendLog(
  deploymentId: string,
  level: DeploymentLogLevel,
  message: string,
): Promise<void> {
  const last = await prisma.deploymentLog.findFirst({
    where: { deploymentId },
    orderBy: { sequence: "desc" },
  });
  const sequence = (last?.sequence ?? 0) + 1;
  await prisma.deploymentLog.create({
    data: { deploymentId, level, message, sequence },
  });
}

async function setDeploymentStatus(
  deploymentId: string,
  status: DeploymentStatus,
): Promise<void> {
  // Guard against corrupting a finished deployment (e.g. a stray late status
  // report from a Node Agent). Invalid transitions are rejected, not applied.
  const current = await prisma.deployment.findUnique({
    where: { id: deploymentId },
    select: { status: true },
  });
  if (isRejectableTransition(current?.status, status)) {
    logger.warn(
      `Rejected invalid deployment status transition ${current?.status} -> ${status} for ${deploymentId}`,
    );
    return;
  }
  await prisma.deployment.update({
    where: { id: deploymentId },
    data: { status, startedAt: status === DeploymentStatus.PREPARING ? new Date() : undefined, finishedAt: status === DeploymentStatus.SUCCESS || status === DeploymentStatus.FAILED || status === DeploymentStatus.CANCELLED ? new Date() : undefined },
  });
}

function buildHooks(deploymentId: string): DeployHooks {
  return {
    log: (level, message) => appendLog(deploymentId, level, message),
    setStatus: (status) => setDeploymentStatus(deploymentId, status),
  };
}

async function resolveWebsiteContext(websiteId: string) {
  const website = await prisma.website.findUnique({
    where: { id: websiteId },
    include: {
      domains: true,
    },
  });
  if (!website) {
    throw new AppError(ErrorCode.WEBSITE_NOT_FOUND);
  }
  const customDomains = website.domains
    .filter((d) => !d.isDefault && d.status === "ACTIVE")
    .map((d) => d.domain);
  return { website, customDomains };
}

export async function processDeployJob(deploymentId: string): Promise<void> {
  const deployment = await prisma.deployment.findUnique({
    where: { id: deploymentId },
  });
  if (!deployment) {
    logger.warn(`Deploy job for missing deployment ${deploymentId}`);
    return;
  }

  const { website, customDomains } = await resolveWebsiteContext(
    deployment.websiteId,
  );
  const providerName = getHostingProvider().name;
  const node: HostingNode | null = await chooseNode(providerName);
  const hooks = buildHooks(deploymentId);

  const ctx: DeployContext = {
    deploymentId: deployment.id,
    websiteId: website.id,
    slug: website.slug,
    defaultDomain: website.defaultDomain,
    customDomains,
    source: deployment.source,
    artifactKey: deployment.artifactKey ?? undefined,
    gitRepo: deployment.githubRepo
      ? {
          name: deployment.githubRepo,
          branch: deployment.githubBranch ?? "main",
          accessToken: await getGitAccessToken(deployment.userId, deployment.githubRepo),
        }
      : undefined,
    build: {
      installCommand: deployment.installCommand,
      buildCommand: deployment.buildCommand,
      outputDirectory: deployment.outputDirectory,
    },
    node,
  };

  // Mark website as deploying.
  await prisma.website.update({
    where: { id: website.id },
    data: { status: WebsiteStatus.DEPLOYING },
  });

  try {
    const result = await getHostingProvider().deployWebsite(ctx, hooks);
    if (result.success) {
      await finalizeSuccessfulDeployment(deployment, website, result);
    } else {
      await finalizeFailedDeployment(deployment, website, result.message);
    }
  } catch (error) {
    logger.error("Deployment crashed", error);
    await finalizeFailedDeployment(
      deployment,
      website,
      (error as Error).message,
    );
  }
}

async function finalizeSuccessfulDeployment(
  deployment: { id: string; websiteId: string },
  website: { id: string; slug: string },
  result: { releasePath?: string; releaseNumber?: number },
): Promise<void> {
  const releaseNumber = result.releaseNumber ?? 1;
  const release = await prisma.release.create({
    data: {
      websiteId: website.id,
      deploymentId: deployment.id,
      releaseNumber,
      status: "ACTIVE",
      path: result.releasePath ?? `releases/${releaseNumber}`,
    },
  });

  // Demote any previously active release.
  await prisma.release.updateMany({
    where: { websiteId: website.id, id: { not: release.id }, status: "ACTIVE" },
    data: { status: "SUPERSEDED" },
  });

  await prisma.deployment.update({
    where: { id: deployment.id },
    data: {
      status: DeploymentStatus.SUCCESS,
      releaseId: release.id,
      releaseNumber,
      finishedAt: new Date(),
    },
  });

  await prisma.website.update({
    where: { id: website.id },
    data: {
      status: WebsiteStatus.ONLINE,
      currentReleaseId: release.id,
      lastDeploymentId: deployment.id,
    },
  });

  await updateUsage(website.id, website.slug);
}

async function finalizeFailedDeployment(
  deployment: { id: string; websiteId: string },
  website: { id: string; slug: string },
  message?: string,
): Promise<void> {
  const lastSuccess = await prisma.deployment.findFirst({
    where: { websiteId: website.id, status: DeploymentStatus.SUCCESS },
    orderBy: { createdAt: "desc" },
  });

  await prisma.deployment.update({
    where: { id: deployment.id },
    data: {
      status: DeploymentStatus.FAILED,
      logSummary: message,
      finishedAt: new Date(),
    },
  });

  // Critical: a failed deployment must NEVER replace a working live release.
  await prisma.website.update({
    where: { id: website.id },
    data: {
      status: lastSuccess ? WebsiteStatus.ONLINE : WebsiteStatus.FAILED,
      lastDeploymentId: deployment.id,
    },
  });
}

export async function processRollbackJob(deploymentId: string): Promise<void> {
  const deployment = await prisma.deployment.findUnique({
    where: { id: deploymentId },
    include: { release: true },
  });
  if (!deployment) return;
  if (!deployment.release) {
    await appendLog(deploymentId, "ERROR", "No release available to roll back to");
    return;
  }

  const { website, customDomains } = await resolveWebsiteContext(
    deployment.websiteId,
  );
  const providerName = getHostingProvider().name;
  const node = await chooseNode(providerName);
  const hooks = buildHooks(deploymentId);

  const result = await getHostingProvider().rollbackWebsite(
    {
      websiteId: website.id,
      slug: website.slug,
      defaultDomain: website.defaultDomain,
      customDomains,
      releasePath: deployment.release.path,
      releaseNumber: deployment.release.releaseNumber,
      node,
    },
    hooks,
  );

  if (result.success) {
    await prisma.release.updateMany({
      where: { websiteId: website.id, status: "ACTIVE" },
      data: { status: "SUPERSEDED" },
    });
    await prisma.release.update({
      where: { id: deployment.release.id },
      data: { status: "ACTIVE" },
    });
    await prisma.website.update({
      where: { id: website.id },
      data: {
        status: WebsiteStatus.ONLINE,
        currentReleaseId: deployment.release.id,
        lastDeploymentId: deployment.id,
      },
    });
    await appendLog(deploymentId, "INFO", "Rollback complete");
  } else {
    await appendLog(deploymentId, "ERROR", result.message ?? "Rollback failed");
  }
  await updateUsage(website.id, website.slug);
}

async function getGitAccessToken(
  userId: string,
  _repoName: string,
): Promise<string | null> {
  const account = await prisma.account.findFirst({
    where: { userId, provider: "github" },
  });
  if (!account?.accessToken) return null;
  const { decryptNullable } = await import(
    "../../infrastructure/crypto/encryption.js"
  );
  return decryptNullable(account.accessToken);
}

async function updateUsage(websiteId: string, slug: string): Promise<void> {
  const period = new Date().toISOString().slice(0, 7);
  const deploymentsCount = await prisma.deployment.count({ where: { websiteId } });
  const provider = getHostingProvider();
  let storageBytes = 0n;
  try {
    const usage = await provider.getUsage({ websiteId, slug });
    storageBytes = BigInt(usage.storageBytes);
  } catch {
    storageBytes = 0n;
  }
  await prisma.usage.upsert({
    where: { websiteId_period: { websiteId, period } },
    create: { websiteId, period, storageBytes, deploymentsCount },
    update: { storageBytes, deploymentsCount },
  });
}

export interface CreateDeploymentParams {
  websiteId: string;
  userId: string;
  source: "ZIP" | "GITHUB";
  artifactKey?: string;
  githubConfig?: {
    repository: string;
    branch: string;
    installCommand?: string;
    buildCommand?: string;
    outputDirectory?: string;
  };
  zipConfig?: {
    installCommand?: string;
    buildCommand?: string;
    outputDirectory?: string;
  };
}

export async function createDeployment(
  params: CreateDeploymentParams,
): Promise<{ id: string; status: DeploymentStatus }> {
  const website = await prisma.website.findFirst({
    where: { id: params.websiteId, userId: params.userId },
  });
  if (!website) throw new AppError(ErrorCode.WEBSITE_NOT_FOUND);

  await assertNodeAvailable(getHostingProvider().name);

  const deployment = await prisma.deployment.create({
    data: {
      websiteId: website.id,
      userId: params.userId,
      source: params.source,
      status: DeploymentStatus.QUEUED,
      artifactKey: params.artifactKey,
      githubRepo: params.githubConfig?.repository,
      githubBranch: params.githubConfig?.branch,
      installCommand:
        params.githubConfig?.installCommand ?? params.zipConfig?.installCommand,
      buildCommand:
        params.githubConfig?.buildCommand ?? params.zipConfig?.buildCommand,
      outputDirectory:
        params.githubConfig?.outputDirectory ??
        params.zipConfig?.outputDirectory,
    },
  });

  const queue = await getQueue();
  await queue.enqueue({ kind: "deploy", deploymentId: deployment.id });
  return { id: deployment.id, status: DeploymentStatus.QUEUED };
}

export async function enqueueRollback(
  deploymentId: string,
  userId: string,
): Promise<void> {
  const deployment = await prisma.deployment.findFirst({
    where: { id: deploymentId, userId },
    include: { release: true },
  });
  if (!deployment) throw new AppError(ErrorCode.DEPLOYMENT_NOT_FOUND);
  if (!deployment.release) {
    throw new AppError(
      ErrorCode.DEPLOYMENT_NOT_ROLLBACKABLE,
      "This deployment has no release to roll back to",
    );
  }
  if (deployment.release.status !== "ACTIVE" && deployment.release.status !== "SUPERSEDED") {
    throw new AppError(
      ErrorCode.DEPLOYMENT_NOT_ROLLBACKABLE,
      "This release is no longer available",
    );
  }
  // Mark the site as deploying while rollback runs.
  await prisma.website.update({
    where: { id: deployment.websiteId },
    data: { status: WebsiteStatus.DEPLOYING },
  });
  const queue = await getQueue();
  await queue.enqueue({ kind: "rollback", deploymentId: deployment.id });
}
