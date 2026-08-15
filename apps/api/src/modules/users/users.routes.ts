import type { FastifyInstance } from "fastify";
import { prisma } from "../../infrastructure/database/prisma.js";
import { authenticate, SESSION_COOKIE } from "../../plugins/auth.js";
import { revokeSession } from "../../infrastructure/auth/session.js";
import { AppError, ErrorCode, formatRelativeTime } from "@babasti/shared";
import { updateProfileSchema } from "@babasti/validation";
import { ok } from "../../shared/http.js";

export async function registerUserRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.get("/users/me", { preHandler: authenticate }, async (request, reply) => {
    const user = request.user!;
    const [accounts, sessions] = await Promise.all([
      prisma.account.findMany({
        where: { userId: user.id },
        select: { provider: true, createdAt: true },
      }),
      prisma.session.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
      }),
    ]);
    const currentToken = request.cookies[SESSION_COOKIE];
    return ok(reply, {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      role: user.role,
      createdAt: user.createdAt,
      connectedAccounts: accounts.map((a) => ({
        provider: a.provider,
        connectedAt: a.createdAt,
      })),
      sessions: sessions.map((s) => ({
        id: s.id,
        current: s.token === currentToken,
        userAgent: s.userAgent,
        ip: s.ip,
        createdAt: s.createdAt,
        expiresAt: s.expiresAt,
      })),
    });
  });

  app.patch("/users/me", { preHandler: authenticate }, async (request, reply) => {
    const input = updateProfileSchema.parse(request.body);
    const updated = await prisma.user.update({
      where: { id: request.user!.id },
      data: { displayName: input.displayName },
    });
    return ok(reply, {
      id: updated.id,
      email: updated.email,
      displayName: updated.displayName,
    });
  });

  app.get("/users/sessions", { preHandler: authenticate }, async (request, reply) => {
    const sessions = await prisma.session.findMany({
      where: { userId: request.user!.id },
      orderBy: { createdAt: "desc" },
    });
    const currentToken = request.cookies[SESSION_COOKIE];
    return ok(reply, {
      items: sessions.map((s) => ({
        id: s.id,
        current: s.token === currentToken,
        userAgent: s.userAgent,
        ip: s.ip,
        createdAt: s.createdAt,
        lastActive: formatRelativeTime(s.createdAt),
      })),
    });
  });

  app.delete(
    "/users/sessions/:id",
    { preHandler: authenticate },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const session = await prisma.session.findFirst({
        where: { id, userId: request.user!.id },
      });
      if (!session) throw new AppError(ErrorCode.NOT_FOUND, "Session not found");
      await revokeSession(session.token);
      return ok(reply, { success: true });
    },
  );
}
