import type { FastifyInstance } from "fastify";
import { Prisma } from "@prisma/client";
import { prisma } from "../../infrastructure/database/prisma.js";
import { loadConfig } from "@babasti/config";
import { authenticate } from "../../plugins/auth.js";
import { getHostingProvider } from "../../infrastructure/hosting/index.js";
import {
  assertNodeAvailable,
  requireNodeById,
} from "../../infrastructure/hosting/scheduler.js";
import { AppError, ErrorCode, generateSlugSuggestion } from "@babasti/shared";
import {
  createWebsiteSchema,
  updateWebsiteSchema,
} from "@babasti/validation";
import { ok } from "../../shared/http.js";
import { getDnsProvider } from "../../infrastructure/dns/cloudflare.js";

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
    const websiteCount = await prisma.website.count({
      where: { userId: request.user!.id },
    });
    if (websiteCount >= config.MAX_WEBSITES_PER_USER) {
      throw new AppError(
        ErrorCode.QUOTA_EXCEEDED,
        `Your plan allows ${config.MAX_WEBSITES_PER_USER} websites`,
      );
    }
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
    let website;
    try {
      // The website and its default domain are one ownership unit. Nested
      // creation prevents a concurrent request or pre-existing custom domain
      // from leaving a website attached to somebody else's DNS name.
      website = await prisma.website.create({
        data: {
          userId: request.user!.id,
          name: input.name,
          slug,
          description: input.description ?? "",
          defaultDomain,
          domains: {
            create: {
              domain: defaultDomain,
              isDefault: true,
              status: "ACTIVE",
              verifiedAt: new Date(),
            },
          },
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new AppError(
          ErrorCode.DOMAIN_TAKEN,
          "This website name or default domain is already taken",
        );
      }
      throw error;
    }
    const provider = getHostingProvider();
    let node: Awaited<ReturnType<typeof assertNodeAvailable>> | null = null;
    let provisioned = false;
    let dnsRecordId: string | null = null;
    try {
      node = await assertNodeAvailable(provider.name);
      const result = await provider.createWebsite({
        websiteId: website.id,
        slug: website.slug,
        defaultDomain: website.defaultDomain,
        customDomains: [],
        node,
      });
      provisioned = true;
      if (provider.name === "real") {
        dnsRecordId = await getDnsProvider().ensureWebsiteRecord(
          website.defaultDomain,
          node.dnsTarget,
        );
      }
      if (dnsRecordId) {
        await prisma.domain.update({
          where: { domain: defaultDomain },
          data: { providerRecordId: dnsRecordId },
        });
      }
      await prisma.website.update({
        where: { id: website.id },
        data: { nodeId: result.nodeId ?? node.id },
      });
    } catch (error) {
      if (dnsRecordId) {
        await getDnsProvider().deleteRecord(dnsRecordId).catch(() => {});
      }
      if (provisioned && node) {
        await provider
          .deleteWebsite({ websiteId: website.id, slug: website.slug, node })
          .catch(() => {});
      }
      await prisma.website.delete({ where: { id: website.id } }).catch(() => {});
      throw error;
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
    const defaultDomain = await prisma.domain.findFirst({
      where: { websiteId, isDefault: true },
      select: { providerRecordId: true },
    });
    const provider = getHostingProvider();
    const node = await requireNodeById(provider.name, website.nodeId);
    await provider.deleteWebsite({
      websiteId: website.id,
      slug: website.slug,
      node,
    });
    await getDnsProvider().deleteRecord(defaultDomain?.providerRecordId);
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
