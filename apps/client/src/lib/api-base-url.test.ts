import assert from "node:assert/strict";
import test from "node:test";
import { resolveApiBaseUrl } from "./api-base-url.js";

test("explicit API URL takes precedence and is normalized", () => {
  assert.equal(
    resolveApiBaseUrl(" https://api.example.com/api/ ", {
      hostname: "panel.babasti.my.id",
      protocol: "https:",
    }),
    "https://api.example.com/api",
  );
});

test("production panel hostname resolves to the API sibling", () => {
  assert.equal(
    resolveApiBaseUrl(undefined, {
      hostname: "panel.babasti.my.id",
      protocol: "https:",
    }),
    "https://api.babasti.my.id/api",
  );
});

test("development and non-panel hosts keep the same-origin API fallback", () => {
  assert.equal(
    resolveApiBaseUrl(undefined, {
      hostname: "localhost",
      protocol: "http:",
    }),
    "/api",
  );
});
