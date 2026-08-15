import type { FastifyInstance } from "fastify";
import { prisma } from "../../infrastructure/database/prisma.js";
import { loadConfig } from "@babasti/config";
import {
  hashPassword,
  verifyPassword,
} from "../../infrastructure/auth/password.js";
import {
  createSession,
  revokeSession,
} from "../../infrastructure/auth/session.js";
import { SESSION_COOKIE, authenticate } from "../../plugins/auth.js";
import {
  getGoogleAuthUrl,
  exchangeGoogleCode,
  fetchGoogleUserInfo,
  isGoogleConfigured,
} from "../../infrastructure/auth/google.js";
import { encryptNullable } from "../../infrastructure/crypto/encryption.js";
import {
  AppError,
  ErrorCode,
  generateId,
  logger,
} from "@babasti/shared";
import {
  registerSchema,
  loginSchema,
  changePasswordSchema,
} from "@babasti/validation";
import { ok } from "../../shared/http.js";

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  const config = loadConfig();

  function setSessionCookie(
    reply: import("fastify").FastifyReply,
    token: string,
    expiresAt: Date,
  ) {
    reply.setCookie(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: config.COOKIE_SECURE,
      sameSite: "lax",
      path: "/",
      expires: expiresAt,
    });
  }

  function clearSessionCookie(reply: import("fastify").FastifyReply) {
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
  }

  app.post("/auth/register", async (request, reply) => {
    const input = registerSchema.parse(request.body);
    const existing = await prisma.user.findUnique({
      where: { email: input.email },
    });
    if (existing) {
      throw new AppError(ErrorCode.EMAIL_TAKEN, "Email is already registered");
    }
    const passwordHash = await hashPassword(input.password);
    const user = await prisma.user.create({
      data: {
        email: input.email,
        displayName: input.displayName,
        passwordHash,
      },
    });
    const { token, expiresAt } = await createSession(
      user.id,
      config.SESSION_TTL,
      { userAgent: request.headers["user-agent"], ip: request.ip },
    );
    setSessionCookie(reply, token, expiresAt);
    return ok(reply, publicUser(user), 201);
  });

  app.post("/auth/login", async (request, reply) => {
    const input = loginSchema.parse(request.body);
    const user = await prisma.user.findUnique({
      where: { email: input.email },
    });
    if (!user || !user.passwordHash) {
      throw new AppError(ErrorCode.INVALID_CREDENTIALS, "Invalid credentials");
    }
    const valid = await verifyPassword(input.password, user.passwordHash);
    if (!valid) {
      throw new AppError(ErrorCode.INVALID_CREDENTIALS, "Invalid credentials");
    }
    const { token, expiresAt } = await createSession(
      user.id,
      config.SESSION_TTL,
      { userAgent: request.headers["user-agent"], ip: request.ip },
    );
    setSessionCookie(reply, token, expiresAt);
    return ok(reply, publicUser(user));
  });

  app.post("/auth/logout", async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE];
    if (token) await revokeSession(token).catch(() => {});
    clearSessionCookie(reply);
    return ok(reply, { success: true });
  });

  app.get("/auth/me", { preHandler: authenticate }, async (request, reply) => {
    return ok(reply, publicUser(request.user!));
  });

  app.post(
    "/auth/password",
    { preHandler: authenticate },
    async (request, reply) => {
      const input = changePasswordSchema.parse(request.body);
      const user = await prisma.user.findUnique({
        where: { id: request.user!.id },
      });
      if (!user?.passwordHash) {
        throw new AppError(
          ErrorCode.BAD_REQUEST,
          "This account uses social login only",
        );
      }
      const valid = await verifyPassword(input.currentPassword, user.passwordHash);
      if (!valid) {
        throw new AppError(
          ErrorCode.INVALID_CREDENTIALS,
          "Current password is incorrect",
        );
      }
      const passwordHash = await hashPassword(input.newPassword);
      await prisma.user.update({
        where: { id: user.id },
        data: { passwordHash },
      });
      return ok(reply, { success: true });
    },
  );

  // ---------- Google OAuth ----------
  app.get("/auth/google", async (request, reply) => {
    if (!isGoogleConfigured()) {
      throw new AppError(
        ErrorCode.BAD_REQUEST,
        "Google login is not configured",
      );
    }
    const state = generateId("oauth", 16);
    reply.setCookie("babasti_oauth_state", state, {
      httpOnly: true,
      secure: config.COOKIE_SECURE,
      sameSite: "lax",
      path: "/",
      maxAge: 600,
    });
    return reply.redirect(getGoogleAuthUrl(state));
  });

  app.get("/auth/google/callback", async (request, reply) => {
    const query = request.query as { code?: string; state?: string };
    const expectedState = request.cookies["babasti_oauth_state"];
    if (!query.code || !query.state || query.state !== expectedState) {
      throw new AppError(ErrorCode.OAUTH_STATE_MISMATCH, "Invalid OAuth state");
    }
    const { accessToken, refreshToken } = await exchangeGoogleCode(query.code);
    const profile = await fetchGoogleUserInfo(accessToken);

    const user = await upsertOAuthUser({
      provider: "google",
      providerAccountId: profile.sub,
      email: profile.email,
      displayName: profile.name ?? profile.email.split("@")[0],
      accessToken,
      refreshToken,
    });

    const { token, expiresAt } = await createSession(
      user.id,
      config.SESSION_TTL,
      { userAgent: request.headers["user-agent"], ip: request.ip },
    );
    setSessionCookie(reply, token, expiresAt);
    return reply.redirect(`${config.CLIENT_URL}/dashboard`);
  });
}

async function upsertOAuthUser(input: {
  provider: string;
  providerAccountId: string;
  email: string;
  displayName: string;
  accessToken: string;
  refreshToken: string | null;
}): Promise<{ id: string }> {
  const account = await prisma.account.findUnique({
    where: {
      provider_providerAccountId: {
        provider: input.provider,
        providerAccountId: input.providerAccountId,
      },
    },
    include: { user: true },
  });
  if (account) {
    await prisma.account.update({
      where: { id: account.id },
      data: {
        accessToken: encryptNullable(input.accessToken),
        refreshToken: input.refreshToken,
      },
    });
    return account.user;
  }

  const existingUser = await prisma.user.findUnique({
    where: { email: input.email },
  });
  if (existingUser) {
    await prisma.account.create({
      data: {
        userId: existingUser.id,
        provider: input.provider,
        providerAccountId: input.providerAccountId,
        accessToken: encryptNullable(input.accessToken),
        refreshToken: input.refreshToken,
      },
    });
    return existingUser;
  }

  const user = await prisma.user.create({
    data: {
      email: input.email,
      displayName: input.displayName,
      accounts: {
        create: {
          provider: input.provider,
          providerAccountId: input.providerAccountId,
          accessToken: encryptNullable(input.accessToken),
          refreshToken: input.refreshToken,
        },
      },
    },
  });
  logger.info(`Created new user via ${input.provider}: ${input.email}`);
  return user;
}

function publicUser(user: {
  id: string;
  email: string;
  displayName: string;
  role: string;
  createdAt: Date;
}) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    createdAt: user.createdAt,
  };
}
