import os from "node:os";
import path from "node:path";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://unused:unused@localhost:5432/unused";
process.env.SESSION_SECRET = "node-agent-test-secret-at-least-16-characters";
process.env.DEPLOYMENT_PROVIDER = "mock";
process.env.NODE_AGENT_TOKEN = "node-agent-test-token";
process.env.GOOGLE_CALLBACK_URL = "http://localhost:3000/api/auth/google/callback";
process.env.GITHUB_CALLBACK_URL = "http://localhost:3000/api/github/callback";
process.env.STORAGE_PATH = path.join(
  os.tmpdir(),
  `babasti-node-agent-test-${process.pid}`,
);
process.env.AGENT_STORAGE = process.env.STORAGE_PATH;
process.env.AGENT_NGINX_CONFIG_DIR = "";
