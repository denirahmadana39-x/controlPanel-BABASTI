import { prisma } from "../database/prisma.js";
import { generateId } from "@babasti/shared";

export interface SessionMeta {
  userAgent?: string;
  ip?: string;
}

export async function createSession(
  userId: string,
  ttlSeconds: number,
  meta: SessionMeta = {},
): Promise<{ token: string; expiresAt: Date }> {
  const token = generateId("sess", 24);
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
  await prisma.session.create({
    data: {
      token,
      userId,
      expiresAt,
      userAgent: meta.userAgent ?? null,
      ip: meta.ip ?? null,
    },
  });
  return { token, expiresAt };
}

export async function getSessionUser(token: string) {
  if (!token) return null;
  const session = await prisma.session.findUnique({
    where: { token },
    include: { user: true },
  });
  if (!session) return null;
  if (session.expiresAt.getTime() < Date.now()) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }
  return session.user;
}

export async function revokeSession(token: string): Promise<void> {
  await prisma.session.deleteMany({ where: { token } });
}

export async function revokeOtherSessions(
  userId: string,
  currentToken: string,
): Promise<number> {
  const result = await prisma.session.deleteMany({
    where: { userId, NOT: { token: currentToken } },
  });
  return result.count;
}
