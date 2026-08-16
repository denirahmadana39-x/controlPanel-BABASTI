import { promises as fs } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { loadConfig } from "@babasti/config";
import { AppError, ErrorCode } from "@babasti/shared";

/**
 * Artifact storage abstraction. The control plane stores uploaded ZIP archives
 * here; the Node Agent downloads them during deployment. A production system
 * would swap this for object storage (S3 / MinIO) without changing callers.
 */

export interface ArtifactStorage {
  saveArtifact(key: string, data: Buffer): Promise<void>;
  readArtifact(key: string): Promise<Buffer>;
  exists(key: string): Promise<boolean>;
}

export class FileSystemArtifactStorage implements ArtifactStorage {
  private readonly root: string;

  constructor(root: string) {
    this.root = path.resolve(root, "artifacts");
  }

  private resolve(key: string): string {
    // Artifact keys are URL-like and always use relative path segments. Treat
    // both slash styles as separators so a key cannot be safe on one OS and
    // become a traversal when the same storage is used on another OS.
    const portableKey = key.replaceAll("\\", "/");
    const segments = portableKey.split("/");
    if (
      key.length === 0 ||
      key.includes("\0") ||
      path.posix.isAbsolute(portableKey) ||
      path.win32.isAbsolute(key) ||
      segments.some((segment) =>
        segment === "" || segment === "." || segment === ".."
      )
    ) {
      throw new AppError(
        ErrorCode.INVALID_ARTIFACT_KEY,
        "Invalid artifact key",
      );
    }

    const full = path.resolve(this.root, ...segments);
    const relative = path.relative(this.root, full);
    if (
      relative === "" ||
      relative === ".." ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)
    ) {
      throw new AppError(
        ErrorCode.INVALID_ARTIFACT_KEY,
        "Invalid artifact key",
      );
    }
    return full;
  }

  async saveArtifact(key: string, data: Buffer): Promise<void> {
    const full = this.resolve(key);
    const parent = path.dirname(full);
    const tmp = path.join(
      parent,
      `.${path.basename(full)}.${process.pid}.${randomUUID()}.tmp`,
    );
    try {
      await fs.mkdir(parent, { recursive: true, mode: 0o700 });
      // Stage the complete payload beside the destination, then atomically
      // rename it so readers can never observe a partially written artifact.
      await fs.writeFile(tmp, data, { flag: "wx", mode: 0o600 });
      await fs.rename(tmp, full);
    } catch (error) {
      await fs.rm(tmp, { force: true }).catch(() => {});
      throw new AppError(
        ErrorCode.ARTIFACT_WRITE_FAILED,
        "Artifact could not be saved",
        error,
      );
    }
  }

  async readArtifact(key: string): Promise<Buffer> {
    const full = this.resolve(key);
    try {
      return await fs.readFile(full);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new AppError(
          ErrorCode.ARTIFACT_NOT_FOUND,
          "Artifact not found",
        );
      }
      throw new AppError(
        ErrorCode.ARTIFACT_READ_FAILED,
        "Artifact could not be read",
        error,
      );
    }
  }

  async exists(key: string): Promise<boolean> {
    const full = this.resolve(key);
    try {
      const stat = await fs.stat(full);
      return stat.isFile();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw new AppError(
        ErrorCode.ARTIFACT_READ_FAILED,
        "Artifact could not be inspected",
        error,
      );
    }
  }
}

let instance: ArtifactStorage | null = null;

export function getStorage(): ArtifactStorage {
  if (!instance) {
    const config = loadConfig();
    instance = new FileSystemArtifactStorage(config.STORAGE_PATH);
  }
  return instance;
}
