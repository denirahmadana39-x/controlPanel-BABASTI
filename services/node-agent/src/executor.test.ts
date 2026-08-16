import { after, test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "@babasti/config";
import {
  NodeExecutor,
  preparePublishRoot,
  requestLocalHttpStatus,
  rewriteNginxForValidation,
} from "./executor.js";

after(async () => {
  await fs.rm(loadConfig().agentStoragePath, { recursive: true, force: true });
});

test("executor rejects slugs that could escape the site storage root", () => {
  const executor = new NodeExecutor();
  assert.throws(
    () =>
      executor.createWebsite({
        websiteId: "website-1",
        slug: "../outside",
        domains: ["outside.example.com"],
      }),
    /invalid website slug/,
  );
  assert.throws(
    () => executor.getStatus("C:\\Windows\\Temp"),
    /invalid website slug/,
  );
});

test("nginx snippet validation uses an unprivileged loopback port", () => {
  const production = [
    "server {",
    "    listen 80;",
    '    server_name "site.babasti.my.id";',
    "}",
  ].join("\n");
  const validation = rewriteNginxForValidation(production, 55321);

  assert.match(validation, /listen 127\.0\.0\.1:55321;/);
  assert.doesNotMatch(validation, /listen 80;/);
  assert.match(production, /listen 80;/);
  assert.throws(
    () => rewriteNginxForValidation(production, 80),
    /invalid nginx validation port/,
  );
});

test("rollback accepts only the release path matching its release number", async () => {
  const executor = new NodeExecutor();
  const result = await executor.startRollback({
    websiteId: "website-1",
    slug: "safe-site",
    domains: ["safe-site.babasti.my.id"],
    releasePath: "../../outside",
    releaseNumber: 1001,
  });
  assert.deepEqual(result, { success: false, message: "invalid release path" });
});

test("publish root automatically unwraps a single folder containing index.html", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "babasti-publish-"));
  const wrapped = path.join(root, "anjaybisa");
  await fs.mkdir(path.join(wrapped, "assets"), { recursive: true });
  await fs.writeFile(path.join(wrapped, "index.html"), "<h1>online</h1>");
  await fs.writeFile(path.join(wrapped, "assets", "app.js"), "ok");

  const result = await preparePublishRoot(root);

  assert.deepEqual(result, {
    success: true,
    sourceDirectory: "anjaybisa",
    candidates: [path.join("anjaybisa", "index.html")],
  });
  assert.equal(await fs.readFile(path.join(root, "index.html"), "utf8"), "<h1>online</h1>");
  assert.equal(await fs.readFile(path.join(root, "assets", "app.js"), "utf8"), "ok");
  await fs.rm(root, { recursive: true, force: true });
});

test("publish root honors an explicitly configured nested directory", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "babasti-publish-"));
  const built = path.join(root, "project", "dist");
  await fs.mkdir(built, { recursive: true });
  await fs.writeFile(path.join(built, "index.html"), "<h1>dist</h1>");

  const result = await preparePublishRoot(root, path.join("project", "dist"));

  assert.equal(result.success, true);
  assert.equal(await fs.readFile(path.join(root, "index.html"), "utf8"), "<h1>dist</h1>");
  await fs.rm(root, { recursive: true, force: true });
});

test("publish root refuses to guess when multiple index files exist", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "babasti-publish-"));
  await fs.mkdir(path.join(root, "first"), { recursive: true });
  await fs.mkdir(path.join(root, "second"), { recursive: true });
  await fs.writeFile(path.join(root, "first", "index.html"), "first");
  await fs.writeFile(path.join(root, "second", "index.html"), "second");

  const result = await preparePublishRoot(root);

  assert.deepEqual(result, {
    success: false,
    candidates: [
      path.join("first", "index.html"),
      path.join("second", "index.html"),
    ],
  });
  await fs.rm(root, { recursive: true, force: true });
});

test("publish root rejects configured paths outside the release", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "babasti-publish-"));
  await assert.rejects(
    preparePublishRoot(root, "../outside"),
    /publish directory escapes release root/,
  );
  await fs.rm(root, { recursive: true, force: true });
});

test("live health check sends the website domain as the HTTP Host header", async () => {
  let receivedHost: string | undefined;
  const server = createServer((request, response) => {
    receivedHost = request.headers.host;
    response.writeHead(204).end();
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const status = await requestLocalHttpStatus(
      "nested-site.babasti.my.id",
      address.port,
    );
    assert.equal(status, 204);
    assert.equal(receivedHost, "nested-site.babasti.my.id");
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});
