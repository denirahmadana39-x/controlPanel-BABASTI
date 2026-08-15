import { test } from "node:test";
import assert from "node:assert/strict";
import {
  slugSchema,
  domainSchema,
  emailSchema,
} from "@babasti/validation";
import { isValidSlug } from "@babasti/shared";
import { RESERVED_SLUGS } from "@babasti/types";

test("valid BabaSTI subdomains / slugs are accepted", () => {
  for (const slug of ["abc", "abc123", "my-site", "team-blog-2026"]) {
    assert.equal(slugSchema.parse(slug), slug);
    assert.equal(isValidSlug(slug), true);
  }
});

test("invalid slugs are rejected", () => {
  for (const slug of [
    "AB", // uppercase
    "my site", // space
    "my_site", // underscore
    "-leading", // leading hyphen
    "has.dots", // dot
    "has/slash",
  ]) {
    assert.throws(() => slugSchema.parse(slug));
    assert.equal(isValidSlug(slug), false);
  }
});

test("reserved slugs are rejected", () => {
  for (const reserved of RESERVED_SLUGS) {
    assert.throws(() => slugSchema.parse(reserved));
    assert.equal(isValidSlug(reserved), false);
  }
  // A slug merely containing a reserved word is still allowed.
  assert.doesNotThrow(() => slugSchema.parse("admin-panel"));
});

test("valid custom domains are accepted", () => {
  for (const d of [
    "example.com",
    "www.example.com",
    "sub.domain.co.uk",
    "my-site.io",
  ]) {
    assert.equal(domainSchema.parse({ domain: d }).domain, d);
  }
});

test("invalid custom domains are rejected", () => {
  for (const d of [
    "not a domain",
    "http://example.com",
    "example",
    ".com",
  ]) {
    assert.throws(() => domainSchema.parse({ domain: d }));
  }
});

test("email validation is strict", () => {
  assert.doesNotThrow(() => emailSchema.parse("user@example.com"));
  assert.throws(() => emailSchema.parse("not-an-email"));
});
