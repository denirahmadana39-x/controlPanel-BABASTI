import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  buildTestApp,
  registerAndLogin,
  runDeploy,
  runRollback,
  makeZip,
  buildMultipart,
  prisma,
} from "../../../test/helpers.js";
import {
  siteRoot,
  currentLink,
} from "../../infrastructure/hosting/zip-utils.js";
import type { FastifyInstance } from "fastify";

let app: FastifyInstance;

before(async () => {
  app = await buildTestApp();
  await app.ready();
});

after(async () => {
  await app.close();
});

afterEach(async () => {
  // Best-effort cleanup of any created websites between tests.
  const sites = await prisma.website.findMany({ select: { id: true, slug: true } });
  for (const s of sites) {
    try {
      await prisma.website.delete({ where: { id: s.id } });
      await fs.rm(siteRoot(s.slug), { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

async function deployZip(app: FastifyInstance, cookies: string, websiteId: string, body: string) {
  const zip = makeZip([{ name: "index.html", data: Buffer.from(body) }]);
  const { body: payload, contentType } = buildMultipart({ name: "site.zip", data: zip, contentType: "application/zip" });
  const res = await app.inject({
    method: "POST",
    url: `/api/websites/${websiteId}/deployments`,
    headers: { cookie: cookies, "content-type": contentType },
    payload,
  });
  assert.equal(res.statusCode, 202, res.body);
  return (JSON.parse(res.body).data as { id: string }).id;
}

test("mock deploy: extracts files, creates a release, and goes ONLINE", async () => {
  const { cookies } = await registerAndLogin(app, `md1-${Date.now()}@example.com`);
  const slug = `md-site-${Date.now()}`;
  const w = await app.inject({
    method: "POST",
    url: "/api/websites",
    headers: { cookie: cookies },
    payload: { name: "md", slug, description: "t" },
  });
  const websiteId = (JSON.parse(w.body).data as { id: string }).id;

  const depId = await deployZip(app, cookies, websiteId, "<h1>v1</h1>");
  await runDeploy(depId);

  const dep = await app.inject({
    method: "GET",
    url: `/api/deployments/${depId}`,
    headers: { cookie: cookies },
  });
  assert.equal(JSON.parse(dep.body).data.status, "SUCCESS");

  const site = await prisma.website.findUnique({ where: { id: websiteId } });
  assert.equal(site!.status, "ONLINE");
  assert.ok(site!.currentReleaseId, "website should reference a current release");

  const release = await prisma.release.findFirst({
    where: { websiteId, status: "ACTIVE" },
  });
  assert.ok(release, "an ACTIVE release should exist");
  assert.equal(release!.releaseNumber, 1001);

  // Filesystem: the live symlink points at the release dir with index.html.
  const link = currentLink(slug);
  const target = await fs.readlink(link);
  assert.ok(target.includes("releases"), `symlink should target a release: ${target}`);
  const index = await fs.readFile(path.join(target, "index.html"), "utf8");
  assert.match(index, /v1/);
});

test("mock rollback: reverts the live release to the previous one", async () => {
  const { cookies } = await registerAndLogin(app, `md2-${Date.now()}@example.com`);
  const slug = `md-roll-${Date.now()}`;
  const w = await app.inject({
    method: "POST",
    url: "/api/websites",
    headers: { cookie: cookies },
    payload: { name: "mdr", slug, description: "t" },
  });
  const websiteId = (JSON.parse(w.body).data as { id: string }).id;

  const dep1 = await deployZip(app, cookies, websiteId, "<h1>v1</h1>");
  await runDeploy(dep1);
  const dep2 = await deployZip(app, cookies, websiteId, "<h1>v2</h1>");
  await runDeploy(dep2);

  let site = await prisma.website.findUnique({ where: { id: websiteId } });
  const rel2 = await prisma.release.findFirst({ where: { websiteId, releaseNumber: 1002 } });
  assert.equal(site!.currentReleaseId, rel2!.id);

  // Roll back to the first deployment.
  const rb = await app.inject({
    method: "POST",
    url: `/api/deployments/${dep1}/rollback`,
    headers: { cookie: cookies },
  });
  assert.equal(rb.statusCode, 202, rb.body);
  await runRollback(dep1);

  site = await prisma.website.findUnique({ where: { id: websiteId } });
  const rel1 = await prisma.release.findFirst({ where: { websiteId, releaseNumber: 1001 } });
  assert.equal(site!.currentReleaseId, rel1!.id, "current release should revert to v1");
  assert.equal(site!.status, "ONLINE");

  const link = currentLink(slug);
  const target = (await fs.readlink(link)).replace(/\\/g, "/");
  assert.ok(target.includes("releases/1001"), `symlink should point at release 1001: ${target}`);
  const index = await fs.readFile(path.join(target, "index.html"), "utf8");
  assert.match(index, /v1/);
});

test("mock deploy failure does not replace a working release", async () => {
  const { cookies, userId } = await registerAndLogin(app, `md3-${Date.now()}@example.com`);
  const slug = `md-fail-${Date.now()}`;
  const w = await app.inject({
    method: "POST",
    url: "/api/websites",
    headers: { cookie: cookies },
    payload: { name: "mdf", slug, description: "t" },
  });
  const websiteId = (JSON.parse(w.body).data as { id: string }).id;

  const okDep = await deployZip(app, cookies, websiteId, "<h1>ok</h1>");
  await runDeploy(okDep);
  const siteOk = await prisma.website.findUnique({ where: { id: websiteId } });
  assert.equal(siteOk!.status, "ONLINE");

  // Now a deployment whose artifact is missing should fail and leave the
  // previously working release intact.
  const bad = await prisma.deployment.create({
    data: {
      websiteId,
      userId,
      source: "ZIP",
      status: "QUEUED",
      artifactKey: "deployments/does-not-exist.zip",
    },
  });
  await runDeploy(bad.id);

  const badDep = await prisma.deployment.findUnique({ where: { id: bad.id } });
  assert.equal(badDep!.status, "FAILED");

  const siteAfter = await prisma.website.findUnique({ where: { id: websiteId } });
  assert.equal(siteAfter!.status, "ONLINE", "failed deploy must not take the site offline");
  assert.equal(siteAfter!.currentReleaseId, siteOk!.currentReleaseId);
});
