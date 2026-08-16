import path from "node:path";
import os from "node:os";

/**
 * Test environment bootstrap. Loaded via `tsx --import ./test/env.ts` before
 * the test runner starts so that every test file sees a deterministic config:
 *  - NODE_ENV=test (disables artificial deploy delays in providers)
 *  - an isolated test database (default babasti_test, override via TEST_DATABASE_URL)
 *  - a throwaway storage directory for release artifacts
 *  - the Mock provider (real-provider verification is done as a separate live run)
 *
 * The test database schema is applied once via `prisma migrate deploy`
 * (project test/CI setup) and is intentionally NOT run here, because spawning
 * `npx prisma` per test-file is slow and can hang on Windows.
 */

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgresql://babasti:password@localhost:5499/babasti_test?schema=public";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = TEST_DATABASE_URL;
// Force the in-memory deployment queue: the test environment has no Redis.
// (The app uses a Redis-backed queue only when REDIS_URL is a non-empty URL.)
process.env.REDIS_URL = "";
process.env.SESSION_SECRET = "test-session-secret-at-least-16-characters";
process.env.SESSION_TTL = "604800";
process.env.DEPLOYMENT_PROVIDER = process.env.DEPLOYMENT_PROVIDER ?? "mock";
process.env.NODE_AGENT_TOKEN =
  process.env.NODE_AGENT_TOKEN ?? "test-node-agent-token-32-characters";
process.env.NODE_REGISTRATION_TOKEN =
  process.env.NODE_REGISTRATION_TOKEN ?? "test-node-registration-token-32-characters";
process.env.STORAGE_PATH = path.join(
  os.tmpdir(),
  `babasti-test-${process.pid}`,
);
process.env.DISABLE_WORKER = "true";
// Valid placeholder OAuth callbacks so config validation passes in tests.
process.env.GOOGLE_CALLBACK_URL =
  process.env.GOOGLE_CALLBACK_URL ??
  "http://localhost:3000/api/auth/google/callback";
process.env.GITHUB_CALLBACK_URL =
  process.env.GITHUB_CALLBACK_URL ??
  "http://localhost:3000/api/github/callback";

// The test database schema is applied once via `prisma migrate deploy`
// (see the project test/CI setup). It is intentionally NOT run here because
// spawning `npx prisma` per test-file is slow and can hang on Windows.
