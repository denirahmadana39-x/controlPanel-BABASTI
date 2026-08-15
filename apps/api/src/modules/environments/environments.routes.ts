import type { FastifyInstance } from "fastify";
import { prisma } from "../../infrastructure/database/prisma.js";
import { authenticate } from "../../plugins/auth.js";
import { AppError, ErrorCode, maskSecret } from "@babasti/shared";
import { replaceEnvironmentSchema } from "@babasti/validation";
import { encrypt, decryptNullable } from "../../infrastructure/crypto/encryption.js";
import { ok } from "../../shared/http.js";

export async function registerEnvironmentRoutes(
  app: FastifyInstance,
): Promise<void> {
  const ownWebsite = async (websiteId: string, userId: string) => {
    const website = await prisma.website.findFirst({
      where: { id: websiteId, userId },
    });
    if (!website) throw new AppError(ErrorCode.WEBSITE_NOT_FOUND);
    return website;
  };

  const readVariables = async (websiteId: string) => {
    const rows = await prisma.environmentVariable.findMany({
      where: { websiteId },
      orderBy: { key: "asc" },
    });
    return rows.map((row) => ({
      id: row.id,
      key: row.key,
      visibility: row.visibility,
      // Secrets are never returned in plaintext.
      value:
        row.visibility === "PUBLIC"
          ? decryptNullable(row.value) ?? ""
          : maskSecret(decryptNullable(row.value) ?? ""),
    }));
  };

  app.get(
    "/websites/:websiteId/environment",
    { preHandler: authenticate },
    async (request, reply) => {
      const { websiteId } = request.params as { websiteId: string };
      await ownWebsite(websiteId, request.user!.id);
      return ok(reply, { items: await readVariables(websiteId) });
    },
  );

  app.put(
    "/websites/:websiteId/environment",
    { preHandler: authenticate },
    async (request, reply) => {
      const { websiteId } = request.params as { websiteId: string };
      await ownWebsite(websiteId, request.user!.id);
      const input = replaceEnvironmentSchema.parse(request.body);

      // Atomic replacement: delete existing then recreate.
      await prisma.environmentVariable.deleteMany({ where: { websiteId } });
      if (input.variables.length > 0) {
        await prisma.environmentVariable.createMany({
          data: input.variables.map((v) => ({
            websiteId,
            key: v.key,
            value: encrypt(v.value),
            visibility: v.visibility,
          })),
        });
      }
      return ok(reply, { items: await readVariables(websiteId) });
    },
  );
}
