import { PrismaClient } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import {
  processDeployJob,
  processRollbackJob,
  createDeployment,
} from "../src/modules/deployments/deployment.service.js";
import { prisma as sharedPrisma } from "../src/infrastructure/database/prisma.js";

export const prisma = sharedPrisma;

export async function buildTestApp(): Promise<FastifyInstance> {
  return buildApp();
}

export function cookieHeader(setCookie: string | string[] | undefined): string {
  if (!setCookie) return "";
  const arr = Array.isArray(setCookie) ? setCookie : [setCookie];
  return arr.map((c) => c.split(";")[0]).join("; ");
}

export async function registerAndLogin(
  app: FastifyInstance,
  email: string,
  password = "Password123",
): Promise<{ cookies: string; email: string; userId: string }> {
  const reg = await app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: { email, password, displayName: email.split("@")[0] },
  });
  if (reg.statusCode >= 400) {
    throw new Error(`register failed: ${reg.statusCode} ${reg.body}`);
  }
  // Registration already establishes a session; reuse its cookie.
  const cookies = cookieHeader(reg.headers["set-cookie"]);
  const me = await app.inject({
    method: "GET",
    url: "/api/auth/me",
    headers: { cookie: cookies },
  });
  const userId = (JSON.parse(me.body).data as { id: string }).id;
  return { cookies, email, userId };
}

export async function login(
  app: FastifyInstance,
  email: string,
  password = "Password123",
): Promise<{ cookies: string }> {
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { email, password },
  });
  if (res.statusCode >= 400) {
    throw new Error(`login failed: ${res.statusCode} ${res.body}`);
  }
  return { cookies: cookieHeader(res.headers["set-cookie"]) };
}

/** Run the deploy worker for a single deployment and wait for it to settle. */
export async function runDeploy(deploymentId: string): Promise<void> {
  await processDeployJob(deploymentId);
}

export async function runRollback(deploymentId: string): Promise<void> {
  await processRollbackJob(deploymentId);
}

export async function createZipDeployment(
  params: Parameters<typeof createDeployment>[0],
): Promise<{ id: string; status: string }> {
  return createDeployment(params);
}

// ---------------------------------------------------------------------------
// Minimal ZIP writer (stored / no compression) so tests do not need a 3rd-party
// zip dependency. Supports arbitrary entry names (including malicious ones).
// ---------------------------------------------------------------------------

const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

export interface ZipEntry {
  name: string;
  data: Buffer;
}

export function makeZip(entries: ZipEntry[]): Buffer {
  const chunks: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, "utf8");
    const crc = crc32(entry.data);
    const size = entry.data.length;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(0, 8); // method: stored
    local.writeUInt16LE(0, 10); // mod time
    local.writeUInt16LE(0, 12); // mod date
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(size, 18); // compressed
    local.writeUInt32LE(size, 22); // uncompressed
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28); // extra len

    chunks.push(local, nameBuf, entry.data);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4); // version made by
    cd.writeUInt16LE(20, 6); // version needed
    cd.writeUInt16LE(0, 8);
    cd.writeUInt16LE(0, 10);
    cd.writeUInt16LE(0, 12);
    cd.writeUInt16LE(0, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(size, 20);
    cd.writeUInt32LE(size, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt16LE(0, 30); // extra
    cd.writeUInt16LE(0, 32); // comment
    cd.writeUInt16LE(0, 34); // disk
    cd.writeUInt16LE(0, 36); // internal attr
    cd.writeUInt32LE(0, 38); // external attr
    cd.writeUInt32LE(offset, 42); // local header offset
    central.push(cd, nameBuf);

    offset += local.length + nameBuf.length + entry.data.length;
  }

  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4); // disk
  end.writeUInt16LE(0, 6); // disk with cd
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20); // comment len

  return Buffer.concat([...chunks, centralBuf, end]);
}

export function buildMultipart(
  file: { name: string; data: Buffer; contentType?: string },
  fields: Record<string, string> = {},
): { body: Buffer; contentType: string } {
  const boundary = "----BabastiTestBoundary";
  const parts: Buffer[] = [];
  for (const [key, value] of Object.entries(fields)) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`,
      ),
    );
  }
  parts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: ${file.contentType ?? "application/zip"}\r\n\r\n`,
    ),
  );
  parts.push(file.data);
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));
  return {
    body: Buffer.concat(parts),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

export const TEST_PASSWORD = "Password123";
export { PrismaClient };
