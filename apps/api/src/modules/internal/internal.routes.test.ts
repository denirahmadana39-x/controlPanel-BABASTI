import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { FastifyInstance } from "fastify";
import { buildTestApp, prisma } from "../../../test/helpers.js";

let app: FastifyInstance;

before(async () => {
  app = await buildTestApp();
  await app.ready();
});

after(async () => {
  await app.close();
});

test("node registration and heartbeat use separate scoped credentials", async () => {
  const name = `node-heartbeat-${Date.now()}`;
  const agentToken = `agent-${Date.now()}-secret`;

  const unauthorized = await app.inject({
    method: "POST",
    url: "/internal/nodes",
    headers: { authorization: "Bearer wrong-registration-token" },
    payload: { name, token: agentToken },
  });
  assert.equal(unauthorized.statusCode, 403);

  const registration = await app.inject({
    method: "POST",
    url: "/internal/nodes",
    headers: {
      authorization: "Bearer test-node-registration-token-32-characters",
    },
    payload: {
      name,
      baseUrl: "https://agent.test.example",
      token: agentToken,
      capabilities: { staticHosting: true },
    },
  });
  assert.equal(registration.statusCode, 201, registration.body);
  const nodeId = (JSON.parse(registration.body) as { id: string }).id;

  const stored = await prisma.hostingNodeReference.findUniqueOrThrow({
    where: { id: nodeId },
  });
  assert.notEqual(stored.token, agentToken, "agent token must be encrypted at rest");
  assert.ok(stored.lastHeartbeat);

  const crossNodeToken = await app.inject({
    method: "POST",
    url: `/internal/nodes/${nodeId}/heartbeat`,
    headers: { authorization: "Bearer another-agent-token" },
    payload: {},
  });
  assert.equal(crossNodeToken.statusCode, 403);

  const heartbeat = await app.inject({
    method: "POST",
    url: `/internal/nodes/${nodeId}/heartbeat`,
    headers: { authorization: `Bearer ${agentToken}` },
    payload: { capabilities: { staticHosting: true } },
  });
  assert.equal(heartbeat.statusCode, 202, heartbeat.body);

  await prisma.hostingNodeReference.delete({ where: { id: nodeId } });
});
