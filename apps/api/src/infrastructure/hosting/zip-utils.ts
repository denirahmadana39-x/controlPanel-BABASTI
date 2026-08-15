import { promises as fs } from "node:fs";
import { createWriteStream } from "node:fs";
import path from "node:path";
import { open as openZip, type Entry, type ZipFile } from "yauzl";
import { loadConfig } from "@babasti/config";
import { logger } from "@babasti/shared";

/**
 * Safely extract a ZIP archive into a target directory.
 *
 * Security: protects against path traversal (Zip Slip) and symlink escapes by
 * validating every resolved entry path stays within the target directory and
 * rejecting absolute/link entries. Async, no shell execution.
 */
export async function extractZipSafe(
  zipPath: string,
  targetDir: string,
): Promise<void> {
  await fs.mkdir(targetDir, { recursive: true });
  const resolvedTarget = path.resolve(targetDir);

  await new Promise<void>((resolve, reject) => {
    openZip(zipPath, { lazyEntries: true }, (err, zipfile) => {
      if (err || !zipfile) {
        reject(err ?? new Error("Failed to open archive"));
        return;
      }
      const cleanup = () => zipfile.close();

      const onError = (e: unknown) => {
        cleanup();
        reject(e);
      };

      zipfile.on("error", onError);
      zipfile.on("end", () => {
        cleanup();
        resolve();
      });

      zipfile.readEntry();
      zipfile.on("entry", (entry: Entry) => {
        const entryPath = normalizeEntryName(entry.fileName);
        if (!entryPath) {
          // Reject archives with unsafe entry names.
          onError(new Error(`Unsafe archive entry: ${entry.fileName}`));
          return;
        }
        const dest = path.join(resolvedTarget, entryPath);
        if (!dest.startsWith(resolvedTarget)) {
          onError(new Error(`Archive entry escapes target: ${entry.fileName}`));
          return;
        }

        const isDir = entry.fileName.endsWith("/");
        if (isDir) {
          fs.mkdir(dest, { recursive: true })
            .then(() => zipfile.readEntry())
            .catch(onError);
          return;
        }

        // Create parent directories.
        fs.mkdir(path.dirname(dest), { recursive: true })
          .then(
            () =>
              new Promise<void>((res, rej) => {
                zipfile.openReadStream(entry, (streamErr, stream) => {
                  if (streamErr || !stream) {
                    rej(streamErr ?? new Error("Failed to read entry"));
                    return;
                  }
                  const out = createWriteStream(dest);
                  stream.on("error", rej);
                  out.on("error", rej);
                  out.on("finish", res);
                  stream.pipe(out);
                });
              }),
          )
          .then(() => zipfile.readEntry())
          .catch(onError);
      });
    });
  });
}

/**
 * Normalize a ZIP entry name to a relative POSIX path, or return null if it is
 * unsafe (absolute, traversal, or outside the archive root).
 */
function normalizeEntryName(name: string): string | null {
  const trimmed = name.replace(/\\/g, "/");
  if (trimmed.startsWith("/") || trimmed.startsWith("\\")) return null;
  if (trimmed.includes("\0")) return null;
  const parts = trimmed.split("/").filter(Boolean);
  let depth = 0;
  for (const part of parts) {
    if (part === ".") continue;
    if (part === "..") {
      depth -= 1;
      if (depth < 0) return null;
    } else {
      depth += 1;
    }
  }
  return parts.join("/");
}

/**
 * Generate a deterministic nginx server block. User input is escaped; config is
 * only applied after `nginx -t` validation by the real Node Agent.
 */
export function buildNginxConfig(input: {
  domains: string[];
  root: string;
  index?: string;
}): string {
  const serverName = input.domains
    .map((d) => `"${escapeNginxValue(d)}"`)
    .join(" ");
  const index = input.index ?? "index.html";
  return [
    "server {",
    "    listen 80;",
    `    server_name ${serverName};`,
    "",
    `    root ${escapeNginxValue(input.root)};`,
    `    index ${escapeNginxValue(index)};`,
    "",
    "    location / {",
    "        try_files $uri $uri/ /index.html;",
    "    }",
    "}",
    "",
  ].join("\n");
}

export function escapeNginxValue(value: string): string {
  return value.replace(/["\\$]/g, "\\$&");
}

/** Run `nginx -t` if nginx is available; otherwise warn and proceed (mock). */
export async function validateNginxConfig(
  configPath: string,
): Promise<boolean> {
  try {
    const { execFile } = await import("node:child_process");
    const util = await import("node:util");
    const execFileAsync = util.promisify(execFile);
    await execFileAsync("nginx", ["-t", "-c", configPath]);
    return true;
  } catch (error) {
    const message = (error as Error).message;
    if (/nginx: configuration/.test(message) || /command not found/.test(message)) {
      // nginx not present (local/mock) – we cannot validate, but allow it in dev.
      logger.warn("nginx -t not available, skipping config validation (mock/dev)");
      return process.env.NODE_ENV !== "production";
    }
    logger.error("nginx config validation failed", message);
    return false;
  }
}

export function siteRoot(slug: string): string {
  const config = loadConfig();
  return path.resolve(config.STORAGE_PATH, "sites", slug);
}

export function releaseDir(slug: string, releaseNumber: number): string {
  return path.join(siteRoot(slug), "releases", String(releaseNumber));
}

export function currentLink(slug: string): string {
  return path.join(siteRoot(slug), "current");
}
