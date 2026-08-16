import { after, test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { loadConfig } from "@babasti/config";
import { NodeExecutor, rewriteNginxForValidation } from "./executor.js";

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
