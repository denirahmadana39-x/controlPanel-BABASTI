import type { FastifyInstance } from "fastify";
import { prisma } from "../../infrastructure/database/prisma.js";
import { loadConfig } from "@babasti/config";
import { authenticate } from "../../plugins/auth.js";
import {
  getGitHubAuthUrl,
  exchangeGitHubCode,
  fetchGitHubUser,
  listGitHubRepositories,
  isGitHubConfigured,
} from "../../infrastructure/auth/github.js";
import { encryptNullable, decryptNullable } from "../../infrastructure/crypto/encryption.js";
import { AppError, ErrorCode, generateId, logger } from "@babasti/shared";
import { githubConnectSchema } from "@babasti/validation";
import { ok } from "../../shared/http.js";

export async function registerGithubRoutes(
  app: FastifyInstance,
): Promise<void> {
  const config = loadConfig();

  app.get("/github/connect", { preHandler: authenticate }, async (request, reply) => {
    if (!isGitHubConfigured()) {
      throw new AppError(ErrorCode.BAD_REQUEST, "GitHub is not configured");
    }
    const state = generateId("gh", 16);
    reply.setCookie("babasti_github_state", state, {
      httpOnly: true,
      secure: config.COOKIE_SECURE,
      sameSite: "lax",
      path: "/",
      maxAge: 600,
    });
    return reply.redirect(getGitHubAuthUrl(state, "connect"));
  });

  app.get("/github/callback", { preHandler: authenticate }, async (request, reply) => {
    const query = request.query as { code?: string; state?: string };
    const expected = request.cookies["babasti_github_state"];
    if (!query.code || !query.state || !expected || query.state.split(":")[1] !== expected) {
      throw new AppError(ErrorCode.OAUTH_STATE_MISMATCH, "Invalid GitHub OAuth state");
    }
    let token: string;
    try {
      token = await exchangeGitHubCode(query.code);
    } catch (error) {
      logger.warn("GitHub exchange failed", error);
      throw new AppError(ErrorCode.GITHUB_AUTH_FAILED, "GitHub authorization failed");
    }
    const profile = await fetchGitHubUser(token);
    await prisma.account.upsert({
      where: {
        provider_providerAccountId: {
          provider: "github",
          providerAccountId: String(profile.id),
        },
      },
      create: {
        userId: request.user!.id,
        provider: "github",
        providerAccountId: String(profile.id),
        accessToken: encryptNullable(token),
      },
      update: { accessToken: encryptNullable(token) },
    });
    return reply.redirect(`${config.CLIENT_URL}/dashboard/settings?tab=connected`);
  });

  app.get("/github/repositories", { preHandler: authenticate }, async (request, reply) => {
    const account = await prisma.account.findFirst({
      where: { userId: request.user!.id, provider: "github" },
    });
    if (!account?.accessToken) {
      return ok(reply, { connected: false, items: [] });
    }
    const token = decryptNullable(account.accessToken) ?? "";
    const repos = await listGitHubRepositories(token);
    return ok(reply, {
      connected: true,
      items: repos.map((r) => ({
        name: r.name,
        defaultBranch: r.defaultBranch,
        private: r.private,
      })),
    });
  });

  app.delete("/github/disconnect", { preHandler: authenticate }, async (request, reply) => {
    await prisma.account.deleteMany({
      where: { userId: request.user!.id, provider: "github" },
    });
    return ok(reply, { success: true });
  });
}
