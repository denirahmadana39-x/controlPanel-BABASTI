import Fastify, { type FastifyInstance } from "fastify";
import helmet from "@fastify/helmet";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import multipart from "@fastify/multipart";
import { loadConfig } from "@babasti/config";
import { serializeError } from "./shared/http.js";

import { registerAuthRoutes } from "./modules/auth/auth.routes.js";
import { registerWebsiteRoutes } from "./modules/websites/websites.routes.js";
import {
  registerDeploymentNestedRoutes,
  registerDeploymentSingleRoutes,
} from "./modules/deployments/deployments.routes.js";
import { registerDomainRoutes } from "./modules/domains/domains.routes.js";
import { registerEnvironmentRoutes } from "./modules/environments/environments.routes.js";
import { registerGithubRoutes } from "./modules/github/github.routes.js";
import { registerUserRoutes } from "./modules/users/users.routes.js";
import { registerOverviewRoutes } from "./modules/overview/overview.routes.js";
import { registerInternalRoutes } from "./modules/internal/internal.routes.js";

export async function buildApp(): Promise<FastifyInstance> {
  const config = loadConfig();
  const app = Fastify({
    trustProxy: true,
    bodyLimit: config.MAX_UPLOAD_BYTES + 10 * 1024 * 1024,
  });

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: ["'self'"],
      },
    },
  });

  await app.register(cors, {
    origin: config.CLIENT_URL,
    credentials: true,
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
  });

  await app.register(cookie, { secret: config.SESSION_SECRET });
  await app.register(rateLimit, {
    max: 200,
    timeWindow: "1 minute",
  });
  await app.register(multipart, {
    limits: { fileSize: config.MAX_UPLOAD_BYTES, files: 1 },
  });

  app.setErrorHandler((error, _request, reply) => {
    const { status, body } = serializeError(error);
    return reply.code(status).send(body);
  });

  // Health check (public).
  app.get("/health", async () => ({ status: "ok" }));

  // Internal agent callbacks (token-guarded inside the module).
  await registerInternalRoutes(app);

  // API modules. Each module declares its full path (e.g. /auth/register,
  // /websites/:websiteId/domains); they are all mounted under the common
  // /api prefix so the paths match the client (e.g. /api/auth/register).
  await app.register(registerAuthRoutes, { prefix: "/api" });
  await app.register(registerWebsiteRoutes, { prefix: "/api/websites" });
  await app.register(registerDeploymentNestedRoutes, {
    prefix: "/api/websites/:websiteId/deployments",
  });
  await app.register(registerDeploymentSingleRoutes, {
    prefix: "/api/deployments",
  });
  await app.register(registerDomainRoutes, { prefix: "/api" });
  await app.register(registerEnvironmentRoutes, { prefix: "/api" });
  await app.register(registerGithubRoutes, { prefix: "/api" });
  await app.register(registerUserRoutes, { prefix: "/api" });
  await app.register(registerOverviewRoutes, { prefix: "/api" });

  return app;
}
