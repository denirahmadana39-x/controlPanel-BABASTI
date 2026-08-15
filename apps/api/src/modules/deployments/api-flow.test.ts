import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  buildTestApp,
  cookieHeader,
  registerAndLogin,
  makeZip,
  buildMultipart,
  runDeploy,
  prisma,
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

test("end-to-end website lifecycle via the API", async () => {
  const { cookies } = await registerAndLogin(app, `flow-${Date.now()}@example.com`);
  const slug = `flow-site-${Date.now()}`;

  // Create website.
  const create = await app.inject({
    method: "POST",
    url: "/api/websites",
    headers: { cookie: cookies },
    payload: { name: "flow", slug, description: "integration" },
  });
  assert.equal(create.statusCode, 201, create.body);
  const websiteId = (JSON.parse(create.body).data as { id: string }).id;

  // Invalid slug is rejected.
  const bad = await app.inject({
    method: "POST",
    url: "/api/websites",
    headers: { cookie: cookies },
    payload: { name: "x", slug: "ab", description: "t" },
  });
  assert.equal(bad.statusCode, 400);

  // Deploy a zip (full path: upload -> worker -> release -> online).
  const zip = makeZip([{ name: "index.html", data: Buffer.from("<h1>hi</h1>") }]);
  const { body, contentType } = buildMultipart({ name: "site.zip", data: zip, contentType: "application/zip" });
  const dep = await app.inject({
    method: "POST",
    url: `/api/websites/${websiteId}/deployments`,
    headers: { cookie: cookies, "content-type": contentType },
    payload: body,
  });
  assert.equal(dep.statusCode, 202, dep.body);
  const deploymentId = (JSON.parse(dep.body).data as { id: string }).id;

  await runDeploy(deploymentId);

  // Deployment detail reflects success.
  const detail = await app.inject({
    method: "GET",
    url: `/api/deployments/${deploymentId}`,
    headers: { cookie: cookies },
  });
  assert.equal(JSON.parse(detail.body).data.status, "SUCCESS");

  // Logs were recorded.
  const logs = await app.inject({
    method: "GET",
    url: `/api/deployments/${deploymentId}/logs`,
    headers: { cookie: cookies },
  });
  const logItems = (JSON.parse(logs.body).data as { items: unknown[] }).items;
  assert.ok(logItems.length > 0, "deployment should have logs");

  // Website is ONLINE and lists under the user's sites.
  const list = await app.inject({
    method: "GET",
    url: "/api/websites",
    headers: { cookie: cookies },
  });
  const found = (JSON.parse(list.body).data as { id: string }[]).find(
    (s) => s.id === websiteId,
  );
  assert.ok(found, "website should appear in the list");

  const me = await app.inject({
    method: "GET",
    url: `/api/websites/${websiteId}`,
    headers: { cookie: cookies },
  });
  assert.equal((JSON.parse(me.body).data as { status: string }).status, "ONLINE");

  // Cleanup.
  await prisma.website.delete({ where: { id: websiteId } }).catch(() => {});
});
