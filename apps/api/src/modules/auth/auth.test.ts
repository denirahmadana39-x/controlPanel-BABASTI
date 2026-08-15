import { test, mock, after, before } from "node:test";
import assert from "node:assert/strict";
import { buildTestApp, cookieHeader, registerAndLogin, login } from "../../../test/helpers.js";
import type { FastifyInstance } from "fastify";

let app: FastifyInstance;
let originalFetch: typeof globalThis.fetch;

before(async () => {
  app = await buildTestApp();
  await app.ready();
  originalFetch = globalThis.fetch;
});

after(async () => {
  globalThis.fetch = originalFetch;
  await app.close();
});

test("register creates a user and sets a session cookie", async () => {
  const email = `reg-${Date.now()}@example.com`;
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: { email, password: "Password123", displayName: "Reg" },
  });
  assert.equal(res.statusCode, 201);
  const cookies = cookieHeader(res.headers["set-cookie"]);
  assert.ok(cookies.includes("babasti_session="));
  const body = JSON.parse(res.body);
  assert.equal(body.data.email, email);
  assert.equal((body.data as { passwordHash?: string }).passwordHash, undefined);
});

test("duplicate registration is rejected", async () => {
  const email = `dup-${Date.now()}@example.com`;
  await app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: { email, password: "Password123", displayName: "Dup" },
  });
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: { email, password: "Password123", displayName: "Dup" },
  });
  assert.equal(res.statusCode, 409);
});

test("login with correct credentials returns a session", async () => {
  const email = `login-${Date.now()}@example.com`;
  await app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: { email, password: "Password123", displayName: "Login" },
  });
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { email, password: "Password123" },
  });
  assert.equal(res.statusCode, 200);
  assert.ok(cookieHeader(res.headers["set-cookie"]).includes("babasti_session="));
});

test("login with wrong password is rejected", async () => {
  const email = `wrong-${Date.now()}@example.com`;
  await app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: { email, password: "Password123", displayName: "Wrong" },
  });
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { email, password: "WrongPass99" },
  });
  assert.equal(res.statusCode, 401);
});

test("authenticated /me returns the user; logout invalidates the session", async () => {
  const { cookies } = await registerAndLogin(app, `me-${Date.now()}@example.com`);
  const me = await app.inject({
    method: "GET",
    url: "/api/auth/me",
    headers: { cookie: cookies },
  });
  assert.equal(me.statusCode, 200);
  assert.ok((JSON.parse(me.body).data as { id: string }).id);

  const logout = await app.inject({
    method: "POST",
    url: "/api/auth/logout",
    headers: { cookie: cookies },
  });
  assert.equal(logout.statusCode, 200);

  const after = await app.inject({
    method: "GET",
    url: "/api/auth/me",
    headers: { cookie: cookies },
  });
  assert.equal(after.statusCode, 401);
});

test("protected routes require authentication", async () => {
  const res = await app.inject({ method: "GET", url: "/api/websites" });
  assert.equal(res.statusCode, 401);
  const me = await app.inject({ method: "GET", url: "/api/auth/me" });
  assert.equal(me.statusCode, 401);
});
