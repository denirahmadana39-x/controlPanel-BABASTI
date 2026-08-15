import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { extractZipSafe } from "./zip-utils.js";
import { makeZip } from "../../../test/helpers.js";

function tmpDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

test("extractZipSafe extracts a valid nested archive", async () => {
  const zip = makeZip([
    { name: "index.html", data: Buffer.from("<h1>hi</h1>") },
    { name: "assets/style.css", data: Buffer.from("body{}") },
    { name: "assets/img/logo.png", data: Buffer.from([1, 2, 3, 4]) },
  ]);
  const dir = await tmpDir("zipsafe-");
  const zipPath = path.join(dir, "a.zip");
  await fs.writeFile(zipPath, zip);
  const target = path.join(dir, "out");
  await extractZipSafe(zipPath, target);

  assert.equal(
    await fs.readFile(path.join(target, "index.html"), "utf8"),
    "<h1>hi</h1>",
  );
  assert.equal(
    await fs.readFile(path.join(target, "assets/style.css"), "utf8"),
    "body{}",
  );
  assert.deepEqual(
    [...(await fs.readFile(path.join(target, "assets/img/logo.png")))],
    [1, 2, 3, 4],
  );
});

test("extractZipSafe rejects a non-archive buffer", async () => {
  const dir = await tmpDir("zipsafe-");
  const zipPath = path.join(dir, "bad.zip");
  await fs.writeFile(zipPath, Buffer.from("this is not a zip file at all"));
  await assert.rejects(() => extractZipSafe(zipPath, path.join(dir, "out")));
});

test("extractZipSafe rejects path traversal entries", async () => {
  const zip = makeZip([
    { name: "../escape.txt", data: Buffer.from("evil") },
  ]);
  const dir = await tmpDir("zipsafe-");
  const zipPath = path.join(dir, "t.zip");
  await fs.writeFile(zipPath, zip);
  await assert.rejects(() => extractZipSafe(zipPath, path.join(dir, "out")));
  // Ensure nothing escaped outside the target directory.
  await assert.rejects(() => fs.access(path.join(dir, "escape.txt")));
});

test("extractZipSafe rejects absolute path entries", async () => {
  const zip = makeZip([
    { name: "/etc/passwd", data: Buffer.from("root") },
  ]);
  const dir = await tmpDir("zipsafe-");
  const zipPath = path.join(dir, "a.zip");
  await fs.writeFile(zipPath, zip);
  await assert.rejects(() => extractZipSafe(zipPath, path.join(dir, "out")));
});

test("extractZipSafe rejects deeply nested traversal", async () => {
  const zip = makeZip([
    { name: "a/b/../../../../escape.txt", data: Buffer.from("evil") },
  ]);
  const dir = await tmpDir("zipsafe-");
  const zipPath = path.join(dir, "a.zip");
  await fs.writeFile(zipPath, zip);
  await assert.rejects(() => extractZipSafe(zipPath, path.join(dir, "out")));
});
