import { test, mock, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { buildTestApp, cookieHeader, registerAndLogin } from "../../../test/helpers.js";
import type { FastifyInstance } from "fastify";

let app: FastifyInstance;
let originalFetch: typeof globalThis.fetch;
// Mutable fetch handler swapped per test; default is a safe no-op.
let fetchHandler: (input: any, init?: any) => Promise<Response> = async () =>
  new Response("{}", { status: 200 });

before(async () => {
  process.env.GOOGLE_CLIENT_ID = "google-id";
  process.env.GOOGLE_CLIENT_SECRET = "google-secret";
  process.env.GOOGLE_CALLBACK_URL = "http://localhost:3000/api/auth/google/callback";
  process.env.GITHUB_CLIENT_ID = "github-id";
  process.env.GITHUB_CLIENT_SECRET = "github-secret";
  process.env.GITHUB_CALLBACK_URL = "http://localhost:3000/api/github/callback";

  originalFetch = globalThis.fetch;
  globalThis.fetch = mock.fn((input: any, init?: any) =>
    fetchHandler(input, init),
  ) as unknown as typeof globalThis.fetch;

  app = await buildTestApp();
  await app.ready();
});

afterEach(() => {
  mock.reset();
  fetchHandler = async () => new Response("{}", { status: 200 });
});

after(async () => {
  globalThis.fetch = originalFetch;
  await app.close();
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

// ----------------------------- Google -----------------------------
test("Google OAuth callback succeeds and creates a session", async () => {
  fetchHandler = async (input: string) => {
    if (input.includes("oauth2.googleapis.com/token")) {
      return jsonResponse({ access_token: "g-tok", refresh_token: "g-ref" });
    }
    if (input.includes("userinfo")) {
      return jsonResponse({
        sub: "google-sub-1",
        email: "google-user@example.com",
        name: "Google User",
      });
    }
    return jsonResponse({}, 404);
  };

  const start = await app.inject({ method: "GET", url: "/api/auth/google" });
  assert.equal(start.statusCode, 302);
  const stateCookie = cookieHeader(start.headers["set-cookie"]);
  const state = stateCookie
    .split(";")
    .find((c) => c.startsWith("babasti_oauth_state="))
    ?.split("=")[1];

  const res = await app.inject({
    method: "GET",
    url: `/api/auth/google/callback?code=abc&state=${state}`,
    headers: { cookie: stateCookie },
  });
  assert.equal(res.statusCode, 302);
  const cookies = cookieHeader(res.headers["set-cookie"]);
  assert.ok(cookies.includes("babasti_session="));

  const me = await app.inject({
    method: "GET",
    url: "/api/auth/me",
    headers: { cookie: cookies },
  });
  assert.equal(JSON.parse(me.body).data.email, "google-user@example.com");
});

test("Google OAuth callback failure is handled cleanly", async () => {
  fetchHandler = async (input: string) => {
    if (input.includes("oauth2.googleapis.com/token")) {
      return jsonResponse({ error: "invalid_grant" }, 400);
    }
    return jsonResponse({}, 200);
  };
  const start = await app.inject({ method: "GET", url: "/api/auth/google" });
  const stateCookie = cookieHeader(start.headers["set-cookie"]);
  const state = stateCookie
    .split(";")
    .find((c) => c.startsWith("babasti_oauth_state="))
    ?.split("=")[1];

  const res = await app.inject({
    method: "GET",
    url: `/api/auth/google/callback?code=abc&state=${state}`,
    headers: { cookie: stateCookie },
  });
  // The provider call fails -> error response, no session created.
  assert.ok(res.statusCode >= 400);
});

// ----------------------------- GitHub -----------------------------
test("GitHub OAuth callback succeeds for an authenticated user", async () => {
  const { cookies } = await registerAndLogin(app, `gh-${Date.now()}@example.com`);

  fetchHandler = async (input: string) => {
    if (input.includes("github.com/login/oauth/access_token")) {
      return jsonResponse({ access_token: "gh-tok" });
    }
    if (input.includes("api.github.com/user")) {
      return jsonResponse({ id: 9911, login: "ghuser", email: "gh@example.com" });
    }
    return jsonResponse({}, 404);
  };

  const connect = await app.inject({
    method: "GET",
    url: "/api/github/connect",
    headers: { cookie: cookies },
  });
  assert.equal(connect.statusCode, 302);
  const ghStateCookie = cookieHeader(connect.headers["set-cookie"]);
  const ghState = ghStateCookie
    .split(";")
    .find((c) => c.startsWith("babasti_github_state="))
    ?.split("=")[1];

  const res = await app.inject({
    method: "GET",
    url: `/api/github/callback?code=abc&state=connect:${ghState}`,
    headers: { cookie: `${cookies}; ${ghStateCookie}` },
  });
  assert.equal(res.statusCode, 302);
});

test("GitHub OAuth callback failure is handled cleanly", async () => {
  const { cookies } = await registerAndLogin(app, `ghf-${Date.now()}@example.com`);

  fetchHandler = async (input: string) => {
    if (input.includes("github.com/login/oauth/access_token")) {
      return jsonResponse({ error: "bad" }, 401);
    }
    return jsonResponse({}, 200);
  };

  const connect = await app.inject({
    method: "GET",
    url: "/api/github/connect",
    headers: { cookie: cookies },
  });
  const ghStateCookie = cookieHeader(connect.headers["set-cookie"]);
  const ghState = ghStateCookie
    .split(";")
    .find((c) => c.startsWith("babasti_github_state="))
    ?.split("=")[1];

  const res = await app.inject({
    method: "GET",
    url: `/api/github/callback?code=abc&state=connect:${ghState}`,
    headers: { cookie: `${cookies}; ${ghStateCookie}` },
  });
  assert.ok(res.statusCode >= 400);
});
