import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "@babasti/config";

test("minimal Node Agent config accepts omitted OAuth callback URLs", () => {
  const config = loadConfig({
    NODE_ENV: "production",
    DATABASE_URL: "postgresql://unused:unused@127.0.0.1:5432/unused",
    SESSION_SECRET: "node-agent-config-test-secret",
    DEPLOYMENT_PROVIDER: "real",
  });

  assert.equal(config.GOOGLE_CALLBACK_URL, "");
  assert.equal(config.GITHUB_CALLBACK_URL, "");
});
