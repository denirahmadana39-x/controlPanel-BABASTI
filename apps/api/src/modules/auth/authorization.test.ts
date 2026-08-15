import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  buildTestApp,
  cookieHeader,
  registerAndLogin,
} from "../../../test/helpers.js";
import type { FastifyInstance } from "fastify";

let app: FastifyInstance;

before(async () => {
  app = await buildTestApp();
  await app.ready();
});

after(async () => {
  await app.close();
});

async function createWebsite(
  cookies: string,
  slug: string,
): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/api/websites",
    headers: { cookie: cookies },
    payload: { name: slug, slug, description: "test" },
  });
  assert.equal(res.statusCode, 201, res.body);
  return (JSON.parse(res.body).data as { id: string }).id;
}

test("user A and B own separate websites; cross-access is denied", async () => {
  const A = await registerAndLogin(app, `ida-${Date.now()}@example.com`);
  const B = await registerAndLogin(app, `idb-${Date.now()}@example.com`);
  const slugA = `site-a-${Date.now()}`;
  const slugB = `site-b-${Date.now()}`;
  const wA = await createWebsite(A.cookies, slugA);
  const wB = await createWebsite(B.cookies, slugB);

  // Positive control: each user can read their own.
  assert.equal(
    (
      await app.inject({
        method: "GET",
        url: `/api/websites/${wA}`,
        headers: { cookie: A.cookies },
      })
    ).statusCode,
    200,
  );
  assert.equal(
    (
      await app.inject({
        method: "GET",
        url: `/api/websites/${wB}`,
        headers: { cookie: B.cookies },
      })
    ).statusCode,
    200,
  );

  // Cross reads are denied (404 resource-not-found, never the other's data).
  assert.equal(
    (
      await app.inject({
        method: "GET",
        url: `/api/websites/${wB}`,
        headers: { cookie: A.cookies },
      })
    ).statusCode,
    404,
  );
  assert.equal(
    (
      await app.inject({
        method: "GET",
        url: `/api/websites/${wA}`,
        headers: { cookie: B.cookies },
      })
    ).statusCode,
    404,
  );

  // Cross update / delete.
  assert.equal(
    (
      await app.inject({
        method: "PATCH",
        url: `/api/websites/${wB}`,
        headers: { cookie: A.cookies },
        payload: { name: "hacked" },
      })
    ).statusCode,
    404,
  );
  assert.equal(
    (
      await app.inject({
        method: "DELETE",
        url: `/api/websites/${wA}`,
        headers: { cookie: B.cookies },
      })
    ).statusCode,
    404,
  );

  // Cross deployments list.
  assert.equal(
    (
      await app.inject({
        method: "GET",
        url: `/api/websites/${wB}/deployments`,
        headers: { cookie: A.cookies },
      })
    ).statusCode,
    404,
  );
});

test("deployment-level, domain and environment cross-access is denied", async () => {
  const A = await registerAndLogin(app, `idc-${Date.now()}@example.com`);
  const B = await registerAndLogin(app, `idd-${Date.now()}@example.com`);
  const wA = await createWebsite(A.cookies, `site-c-${Date.now()}`);

  // Create a deployment under A (GitHub source; no processing needed for ACL test).
  const dep = await app.inject({
    method: "POST",
    url: `/api/websites/${wA}/deployments`,
    headers: { cookie: A.cookies },
    payload: {
      source: "GITHUB",
      githubConfig: { repository: "owner/repo", branch: "main" },
    },
  });
  assert.equal(dep.statusCode, 202);
  const depId = (JSON.parse(dep.body).data as { id: string }).id;

  // B cannot read A's deployment, logs, or roll it back.
  assert.equal(
    (
      await app.inject({
        method: "GET",
        url: `/api/deployments/${depId}`,
        headers: { cookie: B.cookies },
      })
    ).statusCode,
    404,
  );
  assert.equal(
    (
      await app.inject({
        method: "GET",
        url: `/api/deployments/${depId}/logs`,
        headers: { cookie: B.cookies },
      })
    ).statusCode,
    404,
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: `/api/deployments/${depId}/rollback`,
        headers: { cookie: B.cookies },
      })
    ).statusCode,
    404,
  );

  // B cannot manage A's domains or environment variables.
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: `/api/websites/${wA}/domains`,
        headers: { cookie: B.cookies },
        payload: { domain: "example.com" },
      })
    ).statusCode,
    404,
  );
  assert.equal(
    (
      await app.inject({
        method: "PUT",
        url: `/api/websites/${wA}/environment`,
        headers: { cookie: B.cookies },
        payload: { variables: [{ key: "SECRET", value: "x" }] },
      })
    ).statusCode,
    404,
  );

  // Positive control: A can read its own deployment.
  assert.equal(
    (
      await app.inject({
        method: "GET",
        url: `/api/deployments/${depId}`,
        headers: { cookie: A.cookies },
      })
    ).statusCode,
    200,
  );
});
