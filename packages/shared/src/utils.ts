import { randomBytes, createHash } from "node:crypto";
import {
  RESERVED_SLUGS,
  SLUG_REGEX,
  type WebsiteUsage,
} from "@babasti/types";

/** Generate a URL-safe slug-friendly random id. */
export function generateId(prefix = "", bytes = 12): string {
  const id = randomBytes(bytes).toString("hex");
  return prefix ? `${prefix}_${id}` : id;
}

/** Deterministic short hash (used for release ids, etc.). */
export function shortHash(input: string): string {
  return createHash("sha1").update(input).digest("hex").slice(0, 12);
}

const ADJECTIVES = [
  "calm", "brave", "swift", "quiet", "bold", "clever", "merry", "amber",
  "crimson", "azure", "lunar", "solar", "vivid", "noble", "cosmic", "mellow",
];
const NOUNS = [
  "otter", "maple", "comet", "river", "falcon", "willow", "ember", "harbor",
  "cipher", "lotus", "pine", "quartz", "raven", "sage", "tide", "vista",
];

/** Generate a friendly, unique-enough default slug suggestion for a website. */
export function generateSlugSuggestion(seed?: string): string {
  const base =
    (seed ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .replace(/-{2,}/g, "-") || ADJECTIVES[randomBytes(1)[0] % ADJECTIVES.length];
  const suffix = randomBytes(2).toString("hex").slice(0, 4);
  let slug = `${base}-${suffix}`;
  if (slug.length > 63) {
    slug = slug.slice(0, 63).replace(/-+$/, "");
  }
  return slug;
}

export function isValidSlug(slug: string): boolean {
  return SLUG_REGEX.test(slug) && !RESERVED_SLUGS.includes(slug);
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const exp = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  const value = bytes / Math.pow(1024, exp);
  return `${value.toFixed(exp === 0 ? 0 : 1)} ${units[exp]}`;
}

export function formatRelativeTime(date: Date | string | number): string {
  const d = typeof date === "object" ? date : new Date(date);
  const diffMs = Date.now() - d.getTime();
  const sec = Math.round(diffMs / 1000);
  if (sec < 60) return sec <= 1 ? "just now" : `${sec} seconds ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} minute${min === 1 ? "" : "s"} ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? "" : "s"} ago`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${day} day${day === 1 ? "" : "s"} ago`;
  const month = Math.round(day / 30);
  if (month < 12) return `${month} month${month === 1 ? "" : "s"} ago`;
  const year = Math.round(month / 12);
  return `${year} year${year === 1 ? "" : "s"} ago`;
}

/** Mask a secret value for display (e.g. API keys). */
export function maskSecret(value: string): string {
  if (!value) return "";
  if (value.length <= 4) return "•".repeat(value.length);
  return "•".repeat(Math.max(6, value.length - 4)) + value.slice(-4);
}

export function emptyUsage(): WebsiteUsage {
  return { storageBytes: 0, bandwidthBytes: 0, deploymentsCount: 0 };
}
