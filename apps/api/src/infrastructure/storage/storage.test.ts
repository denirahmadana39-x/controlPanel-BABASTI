import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { AppError, ErrorCode } from "@babasti/shared";
import { FileSystemArtifactStorage } from "./index.js";

let root: string;
let storage: FileSystemArtifactStorage;

before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "babasti-artifacts-"));
  storage = new FileSystemArtifactStorage(root);
});

after(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

function hasCode(code: string) {
  return (error: unknown): boolean =>
    error instanceof AppError && error.code === code;
}

test("saveArtifact then readArtifact returns the same content", async () => {
  const key = "roundtrip.bin";
  const data = Buffer.from("babasti-artifact-payload");
  await storage.saveArtifact(key, data);
  const out = await storage.readArtifact(key);
  assert.deepEqual(out, data);
  assert.equal(out.toString(), "babasti-artifact-payload");
});

test("nested artifact keys are supported (e.g. deployments/zip_123.zip)", async () => {
  const key = "deployments/zip_123.zip";
  await storage.saveArtifact(key, Buffer.from("zip-bytes"));
  assert.equal(await storage.exists(key), true);
  const out = await storage.readArtifact(key);
  assert.equal(out.toString(), "zip-bytes");
  assert.equal(
    await fs.readFile(path.join(root, "artifacts", key), "utf8"),
    "zip-bytes",
  );
});

test("path traversal keys are rejected", async () => {
  await assert.rejects(
    () => storage.readArtifact("../escape.txt"),
    hasCode(ErrorCode.INVALID_ARTIFACT_KEY),
  );
  await assert.rejects(
    () => storage.readArtifact("../../etc/passwd"),
    hasCode(ErrorCode.INVALID_ARTIFACT_KEY),
  );
  await assert.rejects(
    () => storage.saveArtifact("../evil.txt", Buffer.from("x")),
    hasCode(ErrorCode.INVALID_ARTIFACT_KEY),
  );
  await assert.rejects(() =>
    storage.saveArtifact("a/../../etc/passwd", Buffer.from("x")),
    hasCode(ErrorCode.INVALID_ARTIFACT_KEY),
  );
  await assert.rejects(
    () => storage.readArtifact("..\\escape.txt"),
    hasCode(ErrorCode.INVALID_ARTIFACT_KEY),
  );
});

test("absolute filesystem paths are rejected", async () => {
  for (const key of [
    "/etc/passwd",
    "C:\\Windows\\system.ini",
    "\\\\server\\share\\artifact.zip",
  ]) {
    await assert.rejects(
      () => storage.readArtifact(key),
      hasCode(ErrorCode.INVALID_ARTIFACT_KEY),
    );
  }
});

test("reading a missing artifact returns the project error", async () => {
  await assert.rejects(
    () => storage.readArtifact("does-not-exist.bin"),
    hasCode(ErrorCode.ARTIFACT_NOT_FOUND),
  );
});

test("a failed atomic rename removes its temporary file", async () => {
  const artifactsRoot = path.join(root, "artifacts");
  await fs.mkdir(path.join(artifactsRoot, "blocked"), { recursive: true });

  await assert.rejects(
    () => storage.saveArtifact("blocked", Buffer.from("incomplete")),
    hasCode(ErrorCode.ARTIFACT_WRITE_FAILED),
  );

  const entries = await fs.readdir(artifactsRoot);
  assert.equal(entries.some((entry) => entry.endsWith(".tmp")), false);
  assert.equal(
    (await fs.stat(path.join(artifactsRoot, "blocked"))).isDirectory(),
    true,
  );
});
