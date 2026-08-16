import { test } from "node:test";
import assert from "node:assert/strict";
import { RealHostingNodeProvider } from "./real-provider.js";
import type { HostingNode } from "./types.js";

const node: HostingNode = {
  id: "node-mini",
  name: "miniPC",
  status: "ONLINE",
  baseUrl: "https://agent3.internal.babasti.my.id/",
  token: "mini-agent-secret",
};

test("real provider sends every website operation to the selected node", async (t) => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.endsWith("/status?slug=my-site")) {
      return Response.json({ status: "ONLINE" });
    }
    if (url.endsWith("/usage?slug=my-site")) {
      return Response.json({
        storageBytes: 1234,
        bandwidthBytes: 0,
        deploymentsCount: 2,
      });
    }
    return Response.json({ success: true, nodeId: "untrusted-agent-id" });
  };

  const provider = new RealHostingNodeProvider();
  const created = await provider.createWebsite({
    websiteId: "website-1",
    slug: "my-site",
    defaultDomain: "my-site.babasti.my.id",
    customDomains: [],
    node,
  });
  assert.equal(created.nodeId, node.id);

  await provider.deleteWebsite({
    websiteId: "website-1",
    slug: "my-site",
    node,
  });
  assert.equal(
    await provider.getWebsiteStatus({
      websiteId: "website-1",
      slug: "my-site",
      node,
    }),
    "ONLINE",
  );
  assert.equal(
    (await provider.getUsage({
      websiteId: "website-1",
      slug: "my-site",
      node,
    })).storageBytes,
    1234,
  );

  assert.equal(calls.length, 4);
  for (const call of calls) {
    assert.match(call.url, /^https:\/\/agent3\.internal\.babasti\.my\.id\/v1\//);
    assert.equal(
      (call.init?.headers as Record<string, string>).authorization,
      "Bearer mini-agent-secret",
    );
  }
  assert.deepEqual(JSON.parse(String(calls[1].init?.body)), { slug: "my-site" });
});

test("real provider rejects a selected node without connection metadata", async () => {
  const provider = new RealHostingNodeProvider();
  await assert.rejects(
    provider.createWebsite({
      websiteId: "website-1",
      slug: "my-site",
      defaultDomain: "my-site.babasti.my.id",
      customDomains: [],
      node: { id: "broken", name: "broken", status: "ONLINE" },
    }),
    /has no base URL/,
  );
});
