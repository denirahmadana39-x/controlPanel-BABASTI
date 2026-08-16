import "dotenv/config";
import Fastify, { type FastifyInstance } from "fastify";
import helmet from "@fastify/helmet";
import { loadConfig } from "@babasti/config";
import { logger } from "@babasti/shared";
import { NodeExecutor } from "./executor.js";

async function buildAgent(): Promise<FastifyInstance> {
  const config = loadConfig();
  const app = Fastify({ trustProxy: true });
  const executor = new NodeExecutor();

  await app.register(helmet);

  // All /v1 routes require the shared node token issued by the control plane.
  app.addHook("preHandler", async (request, reply) => {
    if (!request.routeOptions.url?.startsWith("/v1/")) return;
    const auth = request.headers["authorization"];
    if (auth !== `Bearer ${config.NODE_AGENT_TOKEN}`) {
      return reply.code(403).send({ error: "forbidden" });
    }
  });

  app.get("/health", async () => ({ status: "ok", node: config.NODE_AGENT_TOKEN ? "registered" : "unregistered" }));

  app.post("/v1/websites", async (request, reply) => {
    const body = request.body as {
      websiteId: string;
      slug: string;
      domains: string[];
    };
    const result = executor.createWebsite(body);
    return reply.code(201).send({ nodeId: result.nodeId });
  });

  app.delete("/v1/websites/:websiteId", async (request, reply) => {
    const { websiteId } = request.params as { websiteId: string };
    const slug = (request.body as { slug?: string })?.slug ?? websiteId;
    await executor.deleteWebsite({ websiteId, slug });
    return reply.send({ success: true });
  });

  app.post("/v1/deployments", async (request, reply) => {
    const body = request.body as Parameters<NodeExecutor["startDeploy"]>[0];
    executor.startDeploy(body);
    return reply.code(202).send({ accepted: true });
  });

  app.get("/v1/deployments/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const job = executor.getJob(id);
    return reply.send({
      status: job.status,
      logs: job.logs,
      success: job.result?.success,
      releasePath: job.result?.releasePath,
      releaseNumber: job.result?.releaseNumber,
      message: job.result?.message,
    });
  });

  app.post("/v1/rollbacks", async (request, reply) => {
    const body = request.body as Parameters<NodeExecutor["startRollback"]>[0];
    const result = await executor.startRollback(body);
    return reply.send(result);
  });

  app.get("/v1/websites/:websiteId/status", async (request, reply) => {
    const { websiteId } = request.params as { websiteId: string };
    const slug = (request.query as { slug?: string })?.slug ?? websiteId;
    return reply.send({ status: executor.getStatus(slug) });
  });

  app.get("/v1/websites/:websiteId/usage", async (request, reply) => {
    const { websiteId } = request.params as { websiteId: string };
    const slug = (request.query as { slug?: string })?.slug ?? websiteId;
    return reply.send(await executor.getUsage(slug));
  });

  return app;
}

interface RegisteredNode {
  id: string;
  heartbeatIntervalSeconds: number;
}

function nodeCapabilities() {
  return {
    sources: ["ZIP"],
    staticHosting: true,
    platform: process.platform,
    architecture: process.arch,
  };
}

function controlPlaneHeaders(token: string): Record<string, string> {
  const config = loadConfig();
  const headers: Record<string, string> = {
    "content-type": "application/json",
    authorization: `Bearer ${token}`,
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

async function registerWithControlPlane(): Promise<RegisteredNode | null> {
  const controlPlane = (process.env.CONTROL_PLANE_URL || "http://localhost:3000").replace(/\/$/, "");
  const config = loadConfig();
  const token = config.NODE_AGENT_TOKEN;
  const registrationToken = config.nodeRegistrationToken;
  if (!token || !registrationToken) return null;
  try {
    const res = await fetch(`${controlPlane}/internal/nodes`, {
      method: "POST",
      headers: controlPlaneHeaders(registrationToken),
      body: JSON.stringify({
        name: process.env.NODE_NAME || "proxmox-node-1",
        baseUrl: process.env.PUBLIC_AGENT_URL || "",
        dnsTarget: process.env.CLOUDFLARE_TUNNEL_TARGET || "",
        token,
        capabilities: nodeCapabilities(),
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) {
      const data = (await res.json()) as RegisteredNode;
      logger.info(`Registered node ${data.id} with control plane`);
      return data;
    }
    logger.warn(`Node registration returned ${res.status}`);
  } catch (error) {
    logger.warn("Could not register with control plane", error);
  }
  return null;
}

function startHeartbeat(node: RegisteredNode): NodeJS.Timeout {
  const config = loadConfig();
  const controlPlane = (config.CONTROL_PLANE_URL || "http://localhost:3000").replace(/\/$/, "");
  const intervalSeconds = Math.max(
    5,
    node.heartbeatIntervalSeconds || config.NODE_HEARTBEAT_INTERVAL_SECONDS,
  );
  const heartbeat = async () => {
    try {
      const res = await fetch(
        `${controlPlane}/internal/nodes/${encodeURIComponent(node.id)}/heartbeat`,
        {
          method: "POST",
          headers: controlPlaneHeaders(config.NODE_AGENT_TOKEN),
          body: JSON.stringify({ capabilities: nodeCapabilities() }),
          signal: AbortSignal.timeout(10_000),
        },
      );
      if (!res.ok) logger.warn(`Node heartbeat returned ${res.status}`);
    } catch (error) {
      logger.warn("Node heartbeat failed", error);
    }
  };
  return setInterval(() => void heartbeat(), intervalSeconds * 1000);
}

async function main(): Promise<void> {
  const config = loadConfig();
  const app = await buildAgent();
  const port = Number(process.env.AGENT_PORT || 4000);
  await app.listen({ port, host: config.API_HOST });
  logger.info(`BabaSTI Node Agent listening on :${port}`);
  let heartbeat: NodeJS.Timeout | undefined;
  let registrationRefresh: NodeJS.Timeout | undefined;
  let registeredNodeId: string | undefined;
  let registrationInFlight = false;
  if (config.DEPLOYMENT_PROVIDER === "real") {
    const refreshRegistration = async () => {
      if (registrationInFlight) return;
      registrationInFlight = true;
      try {
        const node = await registerWithControlPlane();
        if (node && node.id !== registeredNodeId) {
          if (heartbeat) clearInterval(heartbeat);
          heartbeat = startHeartbeat(node);
          registeredNodeId = node.id;
        }
      } finally {
        registrationInFlight = false;
      }
    };
    await refreshRegistration();
    registrationRefresh = setInterval(
      () => void refreshRegistration(),
      60_000,
    );
  }
  const shutdown = async () => {
    if (heartbeat) clearInterval(heartbeat);
    if (registrationRefresh) clearInterval(registrationRefresh);
    await app.close();
  };
  process.once("SIGTERM", () => void shutdown());
  process.once("SIGINT", () => void shutdown());
}

main().catch((error) => {
  logger.error("Node agent failed to start", error);
  process.exit(1);
});
