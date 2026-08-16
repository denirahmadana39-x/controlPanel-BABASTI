import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { FastifyInstance } from "fastify";
import {
  buildTestApp,
  registerAndLogin,
  prisma,
} from "../../../test/helpers.js";

let app: FastifyInstance;

before(async () => {
  app = await buildTestApp();
  await app.ready();
});

after(async () => {
  await app.close();
});

test("the default plan limits each user to three websites", async () => {
  const email = `website-quota-${Date.now()}@example.com`;
  const { cookies } = await registerAndLogin(app, email);
  const suffix = Date.now();
  for (let index = 1; index <= 3; index += 1) {
    const response = await app.inject({
      method: "POST",
      url: "/api/websites",
      headers: { cookie: cookies },
      payload: {
        name: `Quota ${index}`,
        slug: `quota-${suffix}-${index}`,
      },
    });
    assert.equal(response.statusCode, 201, response.body);
  }

  const rejected = await app.inject({
    method: "POST",
    url: "/api/websites",
    headers: { cookie: cookies },
    payload: { name: "Quota 4", slug: `quota-${suffix}-4` },
  });
  assert.equal(rejected.statusCode, 413, rejected.body);
  assert.equal(JSON.parse(rejected.body).error.code, "QUOTA_EXCEEDED");

  await prisma.user.delete({ where: { email } });
});

test("a user cannot queue overlapping deployments", async () => {
  const email = `deployment-quota-${Date.now()}@example.com`;
  const { cookies } = await registerAndLogin(app, email);
  const slug = `deployment-quota-${Date.now()}`;
  const websiteResponse = await app.inject({
    method: "POST",
    url: "/api/websites",
    headers: { cookie: cookies },
    payload: { name: "Deployment quota", slug },
  });
  assert.equal(websiteResponse.statusCode, 201, websiteResponse.body);
  const websiteId = JSON.parse(websiteResponse.body).data.id as string;
  const payload = {
    source: "GITHUB",
    githubConfig: { repository: "example/repository", branch: "main" },
  };

  const first = await app.inject({
    method: "POST",
    url: `/api/websites/${websiteId}/deployments`,
    headers: { cookie: cookies },
    payload,
  });
  assert.equal(first.statusCode, 202, first.body);

  const second = await app.inject({
    method: "POST",
    url: `/api/websites/${websiteId}/deployments`,
    headers: { cookie: cookies },
    payload,
  });
  assert.equal(second.statusCode, 413, second.body);
  assert.equal(JSON.parse(second.body).error.code, "QUOTA_EXCEEDED");

  await prisma.user.delete({ where: { email } });
});

test("website creation cannot take a domain already owned by another website", async () => {
  const suffix = Date.now();
  const ownerEmail = `domain-owner-${suffix}@example.com`;
  const claimantEmail = `domain-claimant-${suffix}@example.com`;
  const owner = await registerAndLogin(app, ownerEmail);
  const claimant = await registerAndLogin(app, claimantEmail);
  const ownerSlug = `domain-owner-${suffix}`;
  const claimedSlug = `domain-claimed-${suffix}`;

  const ownerResponse = await app.inject({
    method: "POST",
    url: "/api/websites",
    headers: { cookie: owner.cookies },
    payload: { name: "Domain owner", slug: ownerSlug },
  });
  assert.equal(ownerResponse.statusCode, 201, ownerResponse.body);
  const ownerWebsiteId = JSON.parse(ownerResponse.body).data.id as string;
  await prisma.domain.create({
    data: {
      websiteId: ownerWebsiteId,
      domain: `${claimedSlug}.babasti.my.id`,
      isDefault: false,
      status: "ACTIVE",
    },
  });

  const rejected = await app.inject({
    method: "POST",
    url: "/api/websites",
    headers: { cookie: claimant.cookies },
    payload: { name: "Domain claimant", slug: claimedSlug },
  });
  assert.equal(rejected.statusCode, 409, rejected.body);
  assert.equal(JSON.parse(rejected.body).error.code, "DOMAIN_TAKEN");
  assert.equal(
    await prisma.website.findUnique({ where: { slug: claimedSlug } }),
    null,
  );

  await prisma.user.deleteMany({
    where: { email: { in: [ownerEmail, claimantEmail] } },
  });
});
