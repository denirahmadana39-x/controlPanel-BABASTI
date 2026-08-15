import type { FastifyInstance } from "fastify";
import { prisma } from "../../infrastructure/database/prisma.js";
import { authenticate } from "../../plugins/auth.js";
import { formatBytes, formatRelativeTime } from "@babasti/shared";
import { ok } from "../../shared/http.js";

export async function registerOverviewRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.get("/overview", { preHandler: authenticate }, async (request, reply) => {
    const userId = request.user!.id;

    const [websiteCount, domainCount, deployments, usages, recentWebsites] =
      await Promise.all([
        prisma.website.count({ where: { userId } }),
        prisma.domain.count({
          where: { website: { userId }, isDefault: false },
        }),
        prisma.deployment.findMany({
          where: { userId },
          orderBy: { createdAt: "desc" },
          take: 8,
          include: { website: { select: { name: true, slug: true } } },
        }),
        prisma.usage.findMany({
          where: { website: { userId } },
          orderBy: { period: "desc" },
          take: 1,
        }),
        prisma.website.findMany({
          where: { userId },
          orderBy: { updatedAt: "desc" },
          take: 5,
          select: { name: true, slug: true, status: true, defaultDomain: true, updatedAt: true },
        }),
      ]);

    const deploymentCount = await prisma.deployment.count({ where: { userId } });
    const storageBytes = usages[0]?.storageBytes ?? 0n;

    return ok(reply, {
      counts: {
        websites: websiteCount,
        domains: domainCount,
        deployments: deploymentCount,
      },
      storage: {
        bytes: Number(storageBytes),
        formatted: formatBytes(Number(storageBytes)),
      },
      bandwidth: { bytes: 0, formatted: formatBytes(0) },
      recentDeployments: deployments.map((d) => ({
        id: d.id,
        websiteName: d.website.name,
        slug: d.website.slug,
        status: d.status,
        source: d.source,
        releaseNumber: d.releaseNumber,
        createdAt: d.createdAt,
        relative: formatRelativeTime(d.createdAt),
      })),
      recentWebsites: recentWebsites.map((w) => ({
        name: w.name,
        slug: w.slug,
        status: w.status,
        domain: w.defaultDomain,
        url: `https://${w.defaultDomain}`,
        relative: formatRelativeTime(w.updatedAt),
      })),
    });
  });
}
