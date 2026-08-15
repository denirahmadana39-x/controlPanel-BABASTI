import type { FastifyInstance } from "fastify";
import { prisma } from "../../infrastructure/database/prisma.js";
import { authenticate } from "../../plugins/auth.js";
import { getStorage } from "../../infrastructure/storage/index.js";
import {
  AppError,
  ErrorCode,
  generateId,
} from "@babasti/shared";
import {
  createDeploymentSchema,
  paginationSchema,
} from "@babasti/validation";
import { DeploymentStatus } from "@babasti/types";
import { ok } from "../../shared/http.js";
import {
  createDeployment,
  enqueueRollback,
} from "./deployment.service.js";

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // 50 MB

async function ownWebsite(websiteId: string, userId: string) {
  const website = await prisma.website.findFirst({
    where: { id: websiteId, userId },
  });
  if (!website) throw new AppError(ErrorCode.WEBSITE_NOT_FOUND);
  return website;
}

async function ownDeployment(deploymentId: string, userId: string) {
  const deployment = await prisma.deployment.findFirst({
    where: { id: deploymentId, userId },
  });
  if (!deployment) throw new AppError(ErrorCode.DEPLOYMENT_NOT_FOUND);
  return deployment;
}

/** Nested under /api/websites/:websiteId/deployments */
export async function registerDeploymentNestedRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.get("/", { preHandler: authenticate }, async (request, reply) => {
    const { websiteId } = request.params as { websiteId: string };
    await ownWebsite(websiteId, request.user!.id);
    const { page, limit } = paginationSchema.parse(request.query);
    const [items, total] = await Promise.all([
      prisma.deployment.findMany({
        where: { websiteId },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.deployment.count({ where: { websiteId } }),
    ]);
    return ok(reply, {
      items: items.map(serializeDeployment),
      pagination: { page, limit, total },
    });
  });

  app.post("/", { preHandler: authenticate }, async (request, reply) => {
    const { websiteId } = request.params as { websiteId: string };
    await ownWebsite(websiteId, request.user!.id);

    const contentType = request.headers["content-type"] ?? "";
    if (contentType.includes("multipart/form-data")) {
      return handleZipDeploy(request, reply, websiteId, request.user!.id);
    }

    const input = createDeploymentSchema.parse(request.body);
    if (input.source !== "GITHUB" || !input.githubConfig) {
      throw new AppError(
        ErrorCode.BAD_REQUEST,
        "GitHub deployments require repository and branch",
      );
    }
    const result = await createDeployment({
      websiteId,
      userId: request.user!.id,
      source: "GITHUB",
      githubConfig: input.githubConfig,
    });
    return ok(reply, result, 202);
  });
}

/** Standalone under /api/deployments */
export async function registerDeploymentSingleRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.get("/:id", { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const deployment = await ownDeployment(id, request.user!.id);
    return ok(reply, serializeDeployment(deployment));
  });

  app.get("/:id/logs", { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    await ownDeployment(id, request.user!.id);
    const logs = await prisma.deploymentLog.findMany({
      where: { deploymentId: id },
      orderBy: { sequence: "asc" },
    });
    return ok(reply, {
      items: logs.map((l) => ({
        id: l.id,
        level: l.level,
        message: l.message,
        timestamp: l.timestamp,
      })),
    });
  });

  app.post("/:id/cancel", { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const deployment = await ownDeployment(id, request.user!.id);
    if (
      deployment.status === DeploymentStatus.SUCCESS ||
      deployment.status === DeploymentStatus.FAILED ||
      deployment.status === DeploymentStatus.CANCELLED
    ) {
      throw new AppError(
        ErrorCode.BAD_REQUEST,
        "Deployment can no longer be cancelled",
      );
    }
    await prisma.deployment.update({
      where: { id },
      data: { status: DeploymentStatus.CANCELLED, finishedAt: new Date() },
    });
    return ok(reply, { success: true });
  });

  app.post("/:id/rollback", { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    await ownDeployment(id, request.user!.id);
    await enqueueRollback(id, request.user!.id);
    return ok(reply, { success: true, status: "QUEUED" }, 202);
  });
}

async function handleZipDeploy(
  request: import("fastify").FastifyRequest,
  reply: import("fastify").FastifyReply,
  websiteId: string,
  userId: string,
) {
  const data = await request.file();
  if (!data) {
    throw new AppError(ErrorCode.BAD_REQUEST, "No file uploaded");
  }
  const buffer = await data.toBuffer();
  if (buffer.byteLength > MAX_UPLOAD_BYTES) {
    throw new AppError(ErrorCode.UPLOAD_TOO_LARGE, "Archive exceeds 50 MB limit");
  }
  const isZip =
    data.mimetype === "application/zip" ||
    data.mimetype === "application/x-zip-compressed" ||
    data.filename.toLowerCase().endsWith(".zip");
  if (!isZip) {
    throw new AppError(ErrorCode.INVALID_ARCHIVE, "Upload must be a .zip file");
  }

  const key = `deployments/${generateId("zip", 16)}.zip`;
  await getStorage().saveArtifact(key, buffer);

  const fields = (request.body ?? {}) as Record<string, unknown>;
  const zipConfig = {
    installCommand:
      typeof fields.installCommand === "string" ? fields.installCommand : undefined,
    buildCommand:
      typeof fields.buildCommand === "string" ? fields.buildCommand : undefined,
    outputDirectory:
      typeof fields.outputDirectory === "string"
        ? fields.outputDirectory
        : undefined,
  };

  const result = await createDeployment({
    websiteId,
    userId,
    source: "ZIP",
    artifactKey: key,
    zipConfig,
  });
  return ok(reply, result, 202);
}

function serializeDeployment(d: {
  id: string;
  source: string;
  status: string;
  releaseId: string | null;
  releaseNumber: number | null;
  githubRepo: string | null;
  githubBranch: string | null;
  buildCommand: string | null;
  outputDirectory: string | null;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
}) {
  return {
    id: d.id,
    source: d.source,
    status: d.status,
    releaseId: d.releaseId,
    releaseNumber: d.releaseNumber,
    githubRepo: d.githubRepo,
    githubBranch: d.githubBranch,
    buildCommand: d.buildCommand,
    outputDirectory: d.outputDirectory,
    createdAt: d.createdAt,
    startedAt: d.startedAt,
    finishedAt: d.finishedAt,
  };
}
