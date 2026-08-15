import type { FastifyInstance } from "fastify";
import { prisma } from "../../infrastructure/database/prisma.js";
import { authenticate } from "../../plugins/auth.js";
import { AppError, ErrorCode } from "@babasti/shared";
import { domainSchema } from "@babasti/validation";
import { ok } from "../../shared/http.js";

export async function registerDomainRoutes(
  app: FastifyInstance,
): Promise<void> {
  const ownWebsite = async (websiteId: string, userId: string) => {
    const website = await prisma.website.findFirst({
      where: { id: websiteId, userId },
    });
    if (!website) throw new AppError(ErrorCode.WEBSITE_NOT_FOUND);
    return website;
  };

  app.get(
    "/websites/:websiteId/domains",
    { preHandler: authenticate },
    async (request, reply) => {
      const { websiteId } = request.params as { websiteId: string };
      await ownWebsite(websiteId, request.user!.id);
      const domains = await prisma.domain.findMany({
        where: { websiteId },
        orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
      });
      return ok(reply, {
        items: domains.map((d) => ({
          id: d.id,
          domain: d.domain,
          isDefault: d.isDefault,
          status: d.status,
          verifiedAt: d.verifiedAt,
          instructions: d.isDefault
            ? null
            : cnameInstructions(d.domain),
        })),
      });
    },
  );

  app.post(
    "/websites/:websiteId/domains",
    { preHandler: authenticate },
    async (request, reply) => {
      const { websiteId } = request.params as { websiteId: string };
      const website = await ownWebsite(websiteId, request.user!.id);
      const input = domainSchema.parse(request.body);

      const existing = await prisma.domain.findUnique({
        where: { domain: input.domain },
      });
      if (existing) {
        throw new AppError(
          ErrorCode.DOMAIN_TAKEN,
          "This domain is already registered",
        );
      }

      const domain = await prisma.domain.create({
        data: {
          websiteId: website.id,
          domain: input.domain,
          isDefault: false,
          status: "PENDING",
        },
      });
      return ok(
        reply,
        {
          id: domain.id,
          domain: domain.domain,
          isDefault: domain.isDefault,
          status: domain.status,
          verifiedAt: domain.verifiedAt,
          instructions: cnameInstructions(domain.domain),
        },
        201,
      );
    },
  );

  app.delete(
    "/websites/:websiteId/domains/:domainId",
    { preHandler: authenticate },
    async (request, reply) => {
      const { websiteId, domainId } = request.params as {
        websiteId: string;
        domainId: string;
      };
      const website = await ownWebsite(websiteId, request.user!.id);
      const domain = await prisma.domain.findFirst({
        where: { id: domainId, websiteId: website.id },
      });
      if (!domain) throw new AppError(ErrorCode.DOMAIN_NOT_FOUND);
      if (domain.isDefault) {
        throw new AppError(
          ErrorCode.BAD_REQUEST,
          "The default domain cannot be removed",
        );
      }
      await prisma.domain.delete({ where: { id: domainId } });
      return ok(reply, { success: true });
    },
  );
}

function cnameInstructions(domain: string) {
  return {
    type: "CNAME",
    name: domain,
    value: `cname.babasti.my.id`,
    note: "Point this CNAME record at BabaSTI. Verification will be enabled in a future release; the domain remains PENDING until then.",
  };
}
