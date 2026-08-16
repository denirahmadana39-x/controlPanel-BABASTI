import { test } from "node:test";
import assert from "node:assert/strict";
import { CloudflareDnsProvider } from "./cloudflare.js";

test("Cloudflare DNS creates a proxied CNAME for the selected tunnel", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), init });
    if ((init?.method ?? "GET") === "GET") {
      return Response.json({ success: true, result: [] });
    }
    return Response.json({
      success: true,
      result: {
        id: "dns-record-1",
        name: "demo.babasti.my.id",
        type: "CNAME",
        content: "tunnel-2.cfargotunnel.com",
        proxied: true,
      },
    });
  };

  const provider = new CloudflareDnsProvider({
    apiToken: "dns-token",
    zoneId: "zone-id",
    proxied: true,
    required: true,
  });
  const id = await provider.ensureWebsiteRecord(
    "demo.babasti.my.id",
    "tunnel-2.cfargotunnel.com",
  );
  assert.equal(id, "dns-record-1");
  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /name\.exact=demo\.babasti\.my\.id/);
  assert.equal(calls[1].init?.method, "POST");
  assert.equal(
    (calls[1].init?.headers as Record<string, string>).authorization,
    "Bearer dns-token",
  );
  assert.deepEqual(JSON.parse(String(calls[1].init?.body)), {
    type: "CNAME",
    name: "demo.babasti.my.id",
    content: "tunnel-2.cfargotunnel.com",
    ttl: 1,
    proxied: true,
    comment: "Managed by BabaSTI Hosting",
  });
});

test("Cloudflare DNS refuses to adopt an existing CNAME", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  const methods: string[] = [];
  globalThis.fetch = async (_input, init) => {
    methods.push(init?.method ?? "GET");
    if ((init?.method ?? "GET") === "GET") {
      return Response.json({
        success: true,
        result: [
          {
            id: "existing-record",
            name: "demo.babasti.my.id",
            type: "CNAME",
            content: "new.cfargotunnel.com",
          },
        ],
      });
    }
    throw new Error("an identical record must not be changed");
  };
  const provider = new CloudflareDnsProvider({
    apiToken: "dns-token",
    zoneId: "zone-id",
    required: true,
  });
  await assert.rejects(
    provider.ensureWebsiteRecord(
      "demo.babasti.my.id",
      "new.cfargotunnel.com",
    ),
    /already exists and is not managed/,
  );
  assert.deepEqual(methods, ["GET"]);
});

test("Cloudflare DNS refuses to overwrite an unrelated existing record", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async () =>
    Response.json({
      success: true,
      result: [
        {
          id: "operator-owned-record",
          name: "demo.babasti.my.id",
          type: "CNAME",
          content: "important-service.example.com",
        },
      ],
    });
  const provider = new CloudflareDnsProvider({
    apiToken: "dns-token",
    zoneId: "zone-id",
    required: true,
  });
  await assert.rejects(
    provider.ensureWebsiteRecord(
      "demo.babasti.my.id",
      "node.cfargotunnel.com",
    ),
    (error: unknown) =>
      error instanceof Error &&
      error.message.includes("already exists and is not managed"),
  );
});

test("production DNS fails closed when credentials or node target are missing", async () => {
  const provider = new CloudflareDnsProvider({
    apiToken: "",
    zoneId: "",
    required: true,
  });
  await assert.rejects(
    provider.ensureWebsiteRecord("demo.babasti.my.id", "node.cfargotunnel.com"),
    /credentials are not configured/,
  );
  await assert.rejects(
    provider.ensureWebsiteRecord("demo.babasti.my.id", null),
    /no Cloudflare tunnel target/,
  );
});
