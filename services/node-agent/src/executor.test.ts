import { after, test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { loadConfig } from "@babasti/config";
import { NodeExecutor } from "./executor.js";

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
