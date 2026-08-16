import type { FastifyInstance } from "fastify";
import { prisma } from "../../infrastructure/database/prisma.js";
import { getStorage } from "../../infrastructure/storage/index.js";
import { loadConfig } from "@babasti/config";
import {
  DeploymentLogLevel,
  DeploymentStatus,
  WebsiteStatus,
} from "@babasti/types";
import { AppError, ErrorCode } from "@babasti/shared";
import { serializeError } from "../../shared/http.js";
import { decryptNullable, encryptNullable } from "../../infrastructure/crypto/encryption.js";
import { timingSafeEqual } from "node:crypto";

/**
 * Internal endpoints invoked by Node Agents (real provider mode). These are
 * NOT exposed to the browser and require the NODE_AGENT_TOKEN shared secret.
 * They let a remote agent report deployment progress back to the control
 * plane without the control plane executing anything on the node.
 */
export async function registerInternalRoutes(
  app: FastifyInstance,
): Promise<void> {
  const config = loadConfig();

  const bearerToken = (request: import("fastify").FastifyRequest) => {
    const auth = request.headers.authorization;
    return auth?.startsWith("Bearer ") ? auth.slice(7) : "";
  };

  const tokensEqual = (left: string, right: string): boolean => {
    const a = Buffer.from(left);
    const b = Buffer.from(right);
    return a.length === b.length && timingSafeEqual(a, b);
  };

  const decodeStoredToken = (value: string): string => {
    try {
      return decryptNullable(value) ?? "";
    } catch {
      return value;
    }
  };

  const guardRegistration = (request: import("fastify").FastifyRequest) => {
    const token = bearerToken(request);
    if (
      !config.nodeRegistrationToken ||
      !token ||
      !tokensEqual(token, config.nodeRegistrationToken)
    ) {
      throw new AppError(ErrorCode.FORBIDDEN, "Invalid registration token");
    }
  };

  const guardNode = async (
    request: import("fastify").FastifyRequest,
    expectedNodeId?: string,
  ) => {
    const token = bearerToken(request);
    if (!token) throw new AppError(ErrorCode.FORBIDDEN, "Invalid node token");

    const nodes = await prisma.hostingNodeReference.findMany({
      where: expectedNodeId
        ? { id: expectedNodeId, token: { not: null } }
        : { token: { not: null } },
      select: { token: true },
    });
    const valid = nodes.some(
      (node) =>
        node.token != null && tokensEqual(token, decodeStoredToken(node.token)),
    );
    // Single-node installations that have not configured a distinct bootstrap
    // credential keep working until their agent registers its own token.
    const legacyValid =
      !config.NODE_REGISTRATION_TOKEN &&
      Boolean(config.NODE_AGENT_TOKEN) &&
      tokensEqual(token, config.NODE_AGENT_TOKEN);
    if (!valid && !legacyValid) {
      throw new AppError(ErrorCode.FORBIDDEN, "Invalid node token");
    }
  };

  app.addHook("preHandler", async (request, reply) => {
    if (request.routeOptions.url?.startsWith("/internal/")) {
      try {
        if (
          request.method === "POST" &&
          request.routeOptions.url === "/internal/nodes"
        ) {
          guardRegistration(request);
        } else if (
          request.routeOptions.url === "/internal/nodes/:id/heartbeat"
        ) {
          const { id } = request.params as { id: string };
          await guardNode(request, id);
        } else {
          await guardNode(request);
        }
      } catch (error) {
        const { status, body } = serializeError(error);
        return reply.code(status).send(body);
      }
    }
  });

  app.post("/internal/deployments/:id/log", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as {
      level?: DeploymentLogLevel;
      message: string;
    };
    const last = await prisma.deploymentLog.findFirst({
      where: { deploymentId: id },
      orderBy: { sequence: "desc" },
    });
    await prisma.deploymentLog.create({
      data: {
        deploymentId: id,
        level: body.level ?? "INFO",
        message: body.message,
        sequence: (last?.sequence ?? 0) + 1,
      },
    });
    return reply.code(202).send({ ok: true });
  });

  app.post("/internal/deployments/:id/status", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as {
      status: DeploymentStatus;
      releasePath?: string;
      releaseNumber?: number;
      success?: boolean;
    };
    const update: Record<string, unknown> = { status: body.status };
    if (body.status === DeploymentStatus.SUCCESS) {
      update.finishedAt = new Date();
      if (body.releaseNumber) update.releaseNumber = body.releaseNumber;
    }
    if (
      body.status === DeploymentStatus.FAILED ||
      body.status === DeploymentStatus.CANCELLED
    ) {
      update.finishedAt = new Date();
    }
    await prisma.deployment.update({ where: { id }, data: update });
    return reply.code(202).send({ ok: true });
  });

  app.post("/internal/deployments/:id/finalize", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as {
      success: boolean;
      releasePath?: string;
      releaseNumber?: number;
      message?: string;
    };
    const deployment = await prisma.deployment.findUnique({ where: { id } });
    if (!deployment) return reply.code(404).send({ error: "not found" });
    if (body.success) {
      const releaseNumber = body.releaseNumber ?? 1;
      const release = await prisma.release.create({
        data: {
          websiteId: deployment.websiteId,
          deploymentId: deployment.id,
          releaseNumber,
          status: "ACTIVE",
          path: body.releasePath ?? `releases/${releaseNumber}`,
        },
      });
      await prisma.release.updateMany({
        where: {
          websiteId: deployment.websiteId,
          id: { not: release.id },
          status: "ACTIVE",
        },
        data: { status: "SUPERSEDED" },
      });
      await prisma.deployment.update({
        where: { id },
        data: {
          status: DeploymentStatus.SUCCESS,
          releaseId: release.id,
          releaseNumber,
          finishedAt: new Date(),
        },
      });
      await prisma.website.update({
        where: { id: deployment.websiteId },
        data: {
          status: WebsiteStatus.ONLINE,
          currentReleaseId: release.id,
          lastDeploymentId: deployment.id,
        },
      });
    } else {
      await prisma.deployment.update({
        where: { id },
        data: {
          status: DeploymentStatus.FAILED,
          logSummary: body.message,
          finishedAt: new Date(),
        },
      });
      const lastSuccess = await prisma.deployment.findFirst({
        where: { websiteId: deployment.websiteId, status: DeploymentStatus.SUCCESS },
        orderBy: { createdAt: "desc" },
      });
      await prisma.website.update({
        where: { id: deployment.websiteId },
        data: {
          status: lastSuccess ? WebsiteStatus.ONLINE : WebsiteStatus.FAILED,
          lastDeploymentId: deployment.id,
        },
      });
    }
    return reply.code(202).send({ ok: true });
  });

  app.get("/internal/health", async (_request, reply) => {
    return reply.send({ status: "ok" });
  });

  // Node Agents register themselves with the control plane using the shared
  // node token. This is the ONLY way a node becomes eligible for scheduling.
  app.post("/internal/nodes", async (request, reply) => {
    guardRegistration(request);
    const body = request.body as {
      name?: string;
      baseUrl?: string;
      dnsTarget?: string;
      token?: string;
      capabilities?: unknown;
    };
    const name = body.name?.trim() || "node";
    const baseUrl = body.baseUrl?.trim() || config.NODE_AGENT_URL || null;
    if (baseUrl) {
      try {
        const parsed = new URL(baseUrl);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          throw new Error("unsupported protocol");
        }
      } catch {
        throw new AppError(ErrorCode.BAD_REQUEST, "Invalid node base URL");
      }
    }
    const agentToken = body.token || config.NODE_AGENT_TOKEN;
    if (!agentToken) {
      throw new AppError(ErrorCode.BAD_REQUEST, "Node token is required");
    }
    const now = new Date();
    const dnsTarget = body.dnsTarget?.trim().toLowerCase() || null;
    if (dnsTarget && !/^[a-z0-9-]+\.cfargotunnel\.com$/.test(dnsTarget)) {
      throw new AppError(ErrorCode.BAD_REQUEST, "Invalid Cloudflare tunnel target");
    }
    const capabilities = body.capabilities
      ? JSON.stringify(body.capabilities)
      : undefined;
    const node = await prisma.hostingNodeReference.upsert({
      where: { name },
      create: {
        name,
        status: "ONLINE",
        baseUrl,
        dnsTarget,
        token: encryptNullable(agentToken),
        registeredAt: now,
        lastHeartbeat: now,
        capabilities,
      },
      update: {
        status: "ONLINE",
        baseUrl: baseUrl ?? undefined,
        dnsTarget: dnsTarget ?? undefined,
        token: encryptNullable(agentToken),
        registeredAt: now,
        lastHeartbeat: now,
        capabilities,
      },
    });
    return reply.code(201).send({
      id: node.id,
      name: node.name,
      heartbeatIntervalSeconds: config.NODE_HEARTBEAT_INTERVAL_SECONDS,
    });
  });

  app.post("/internal/nodes/:id/heartbeat", async (request, reply) => {
    const { id } = request.params as { id: string };
    await guardNode(request, id);
    const body = request.body as { capabilities?: unknown } | null;
    await prisma.hostingNodeReference.update({
      where: { id },
      data: {
        status: "ONLINE",
        lastHeartbeat: new Date(),
        capabilities: body?.capabilities
          ? JSON.stringify(body.capabilities)
          : undefined,
      },
    });
    return reply.code(202).send({ ok: true });
  });

  // Node agents download uploaded artifacts from here (token-guarded).
  // The artifact key contains slashes (e.g. "deployments/<id>.zip"), so we
  // use a wildcard segment to capture the full key.
  app.get("/internal/artifacts/*", async (request, reply) => {
    await guardNode(request);
    const key = (request.params as { "*": string })["*"];
    const storage = getStorage();
    if (!(await storage.exists(key))) {
      return reply.code(404).send({ error: "not found" });
    }
    const buffer = await storage.readArtifact(key);
    reply.header("content-type", "application/zip");
    return reply.send(buffer);
  });
}
