import type { FastifyRequest } from "fastify";
import { getSessionUser } from "../infrastructure/auth/session.js";
import { AppError, ErrorCode } from "@babasti/shared";
import type { User } from "@prisma/client";

declare module "fastify" {
  interface FastifyRequest {
    user?: User;
  }
}

export const SESSION_COOKIE = "babasti_session";

export async function authenticate(request: FastifyRequest): Promise<void> {
  const token = request.cookies[SESSION_COOKIE];
  if (!token) {
    throw new AppError(ErrorCode.UNAUTHENTICATED, "Authentication required");
  }
  const user = await getSessionUser(token);
  if (!user) {
    throw new AppError(ErrorCode.UNAUTHENTICATED, "Session expired");
  }
  request.user = user;
}
