import type { FastifyInstance } from "fastify";
import { prisma } from "../../infrastructure/database/prisma.js";
import { loadConfig } from "@babasti/config";
import { authenticate } from "../../plugins/auth.js";
import { getHostingProvider } from "../../infrastructure/hosting/index.js";
import { assertNodeAvailable } from "../../infrastructure/hosting/scheduler.js";
import { AppError, ErrorCode, generateSlugSuggestion, logger } from "@babasti/shared";
import {
  createWebsiteSchema,
  updateWebsiteSchema,
} from "@babasti/validation";
import { ok } from "../../shared/http.js";

export async function registerWebsiteRoutes(
  app: FastifyInstance,
): Promise<void> {
  const config = loadConfig();

  const ownWebsite = async (websiteId: string, userId: string) => {
    const website = await prisma.website.findFirst({
      where: { id: websiteId, userId },
    });
    if (!website) throw new AppError(ErrorCode.WEBSITE_NOT_FOUND);
    return website;
  };

  const lastDeploymentOf = (websiteId: string) =>
    prisma.deployment.findFirst({
      where: { websiteId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        status: true,
        releaseNumber: true,
        createdAt: true,
      },
    });

  app.get("/", { preHandler: authenticate }, async (request, reply) => {
    const websites = await prisma.website.findMany({
      where: { userId: request.user!.id },
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { deployments: true, domains: true } } },
    });
    const result = await Promise.all(
      websites.map(async (w) => ({
        ...serializeWebsite(w, w._count),
        lastDeployment: await lastDeploymentOf(w.id),
      })),
    );
    return ok(reply, result);
  });

  app.post("/", { preHandler: authenticate }, async (request, reply) => {
    const input = createWebsiteSchema.parse(request.body);
    const slug = input.slug;
    const defaultDomain = `${slug}.${config.DEFAULT_DOMAIN_SUFFIX}`;
    const existing = await prisma.website.findFirst({
      where: { OR: [{ slug }, { defaultDomain }] },
    });
    if (existing) {
      throw new AppError(
        ErrorCode.WEBSITE_SLUG_TAKEN,
        "This name is already taken",
      );
    }
    const website = await prisma.website.create({
      data: {
        userId: request.user!.id,
        name: input.name,
        slug,
        description: input.description ?? "",
        defaultDomain,
      },
    });
    // Ensure the default domain record exists.
    await prisma.domain.upsert({
      where: { domain: defaultDomain },
      create: {
        websiteId: website.id,
        domain: defaultDomain,
        isDefault: true,
        status: "ACTIVE",
        verifiedAt: new Date(),
      },
      update: { isDefault: true },
    });
    try {
      const node = await assertNodeAvailable(getHostingProvider().name);
      await getHostingProvider().createWebsite({
        websiteId: website.id,
        slug: website.slug,
        defaultDomain: website.defaultDomain,
        customDomains: [],
        node,
      });
    } catch (error) {
      logger.warn("Website node provisioning skipped", error);
    }
    const full = await prisma.website.findUnique({
      where: { id: website.id },
      include: { _count: { select: { deployments: true, domains: true } } },
    });
    return ok(
      reply,
      {
        ...serializeWebsite(full!, full!._count),
        lastDeployment: await lastDeploymentOf(website.id),
      },
      201,
    );
  });

  app.get("/suggest-slug", { preHandler: authenticate }, async (request, reply) => {
    const q = (request.query as { name?: string }).name;
    let slug = generateSlugSuggestion(q);
    for (let i = 0; i < 5; i++) {
      const exists = await prisma.website.findUnique({ where: { slug } });
      if (!exists) break;
      slug = generateSlugSuggestion(q);
    }
    return ok(reply, { slug });
  });

  app.get("/:websiteId", { preHandler: authenticate }, async (request, reply) => {
    const { websiteId } = request.params as { websiteId: string };
    const website = await ownWebsite(websiteId, request.user!.id);
    const full = await prisma.website.findUnique({
      where: { id: website.id },
      include: {
        domains: true,
        environmentVariables: true,
        _count: { select: { deployments: true } },
      },
    });
    return ok(reply, {
      ...serializeWebsiteDetail(full!, full!._count),
      lastDeployment: await lastDeploymentOf(website.id),
    });
  });

  app.patch("/:websiteId", { preHandler: authenticate }, async (request, reply) => {
    const { websiteId } = request.params as { websiteId: string };
    await ownWebsite(websiteId, request.user!.id);
    const input = updateWebsiteSchema.parse(request.body);
    const updated = await prisma.website.update({
      where: { id: websiteId },
      data: input,
      include: { _count: { select: { deployments: true, domains: true } } },
    });
    return ok(reply, serializeWebsite(updated, updated._count));
  });

  app.delete("/:websiteId", { preHandler: authenticate }, async (request, reply) => {
    const { websiteId } = request.params as { websiteId: string };
    const website = await ownWebsite(websiteId, request.user!.id);
    try {
      await getHostingProvider().deleteWebsite({
        websiteId: website.id,
        slug: website.slug,
      });
    } catch (error) {
      logger.warn("Node cleanup failed", error);
    }
    await prisma.website.delete({ where: { id: websiteId } });
    return ok(reply, { success: true });
  });
}

function serializeWebsite(
  website: {
    id: string;
    name: string;
    slug: string;
    description: string;
    status: string;
    defaultDomain: string;
    createdAt: Date;
  },
  counts: { deployments: number; domains: number },
) {
  return {
    id: website.id,
    name: website.name,
    slug: website.slug,
    description: website.description,
    status: website.status,
    defaultDomain: website.defaultDomain,
    url: `https://${website.defaultDomain}`,
    createdAt: website.createdAt,
    deploymentsCount: counts?.deployments ?? 0,
    domainsCount: counts?.domains ?? 0,
  };
}

function serializeWebsiteDetail(
  website: {
    id: string;
    name: string;
    slug: string;
    description: string;
    status: string;
    defaultDomain: string;
    currentReleaseId: string | null;
    createdAt: Date;
    updatedAt: Date;
    domains: Array<{
      id: string;
      domain: string;
      isDefault: boolean;
      status: string;
      verifiedAt: Date | null;
    }>;
  },
  counts: { deployments: number },
) {
  return {
    id: website.id,
    name: website.name,
    slug: website.slug,
    description: website.description,
    status: website.status,
    defaultDomain: website.defaultDomain,
    url: `https://${website.defaultDomain}`,
    currentReleaseId: website.currentReleaseId,
    createdAt: website.createdAt,
    updatedAt: website.updatedAt,
    domains: website.domains.map((d) => ({
      id: d.id,
      domain: d.domain,
      isDefault: d.isDefault,
      status: d.status,
      verifiedAt: d.verifiedAt,
    })),
    deploymentsCount: counts?.deployments ?? 0,
  };
}
