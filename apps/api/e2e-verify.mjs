// Live end-to-end verification for the Real Hosting Provider + Node Agent.
// Exercises: register/login, website create, ZIP deploy through the real
// provider -> agent, release creation, atomic symlink, rollback, and the
// agent token guard (node security). Uses global fetch (Node 22).
import { promises as fs, appendFileSync } from "node:fs";
import path from "node:path";

const API = process.env.API_BASE || "http://localhost:3005";
const AGENT = process.env.AGENT_BASE || "http://localhost:4105";
const AGENT_TOKEN = process.env.NODE_AGENT_TOKEN || "test-node-token";
const AGENT_STORAGE = process.env.AGENT_STORAGE || "C:\\Users\\admin\\AppData\\Local\\Temp\\agent-storage";
const LOGF = "C:\\Users\\admin\\AppData\\Local\\Temp\\verify.log";

function trace(m) { try { appendFileSync(LOGF, m + "\n"); } catch {} }

let pass = 0;
let fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log(`PASS ${name}`); trace(`PASS ${name}`); }
  else { fail++; console.log(`FAIL ${name}${extra ? " :: " + extra : ""}`); trace(`FAIL ${name}${extra ? " :: " + extra : ""}`); }
}

function boundary() { return "----e2eboundary" + Math.random().toString(36).slice(2); }
function buildMultipart(file) {
  const b = boundary();
  const head = Buffer.from(`--${b}\r\ncontent-disposition: form-data; name="file"; filename="${file.name}"\r\ncontent-type: ${file.contentType}\r\n\r\n`);
  const tail = Buffer.from(`\r\n--${b}--\r\n`);
  return { body: Buffer.concat([head, file.data, tail]), contentType: `multipart/form-data; boundary=${b}` };
}
function makeZip(files) {
  // 1-file local-header zip with STORE (no compression), crc32 included.
  const crcTable = [];
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcTable[n] = c >>> 0; }
  const crc32 = (buf) => { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const enc = new TextEncoder();
  const chunks = []; let offset = 0; const central = [];
  for (const f of files) {
    const name = enc.encode(f.name); const data = enc.encode(f.data); const crc = crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0, 6);
    lh.writeUInt16LE(0, 8); lh.writeUInt16LE(0, 10); lh.writeUInt16LE(0, 12);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(name.length, 26); lh.writeUInt16LE(0, 28);
    chunks.push(lh, name, data);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0, 8); cd.writeUInt16LE(0, 10); cd.writeUInt16LE(0, 12);
    cd.writeUInt32LE(crc, 16); cd.writeUInt32LE(data.length, 20); cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(name.length, 28); cd.writeUInt16LE(0, 30); cd.writeUInt16LE(0, 32);
    cd.writeUInt16LE(0, 34); cd.writeUInt16LE(0, 36); cd.writeUInt16LE(0, 38);
    cd.writeUInt32LE(offset, 42);
    central.push(Buffer.concat([cd, name]));
    offset += lh.length + name.length + data.length;
  }
  const centralBuf = Buffer.concat(central); const cenOff = offset; const cenSize = centralBuf.length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(0, 4); end.writeUInt16LE(0, 6);
  end.writeUInt16LE(central.length, 8); end.writeUInt16LE(central.length, 10);
  end.writeUInt32LE(cenSize, 12); end.writeUInt32LE(cenOff, 16); end.writeUInt16LE(0, 20);
  return Buffer.concat([...chunks, centralBuf, end]);
}

async function req(method, url, { body, contentType, cookie, token } = {}) {
  const headers = {};
  if (contentType) headers["content-type"] = contentType;
  if (cookie) headers["cookie"] = cookie;
  if (token) headers["authorization"] = `Bearer ${token}`;
  const res = await fetch(url, { method, body, headers, signal: AbortSignal.timeout(15000) });
  const setCookie = res.headers.get("set-cookie");
  let data = null;
  const text = await res.text();
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, data, setCookie };
}

async function waitFor(fn, timeoutMs = 15000, intervalMs = 1000, label) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try { if (await fn()) return true; } catch (e) { if (label) trace(`waitFor ${label} err ${e.message}`); }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

async function main() {
  // Hard timeout so the verifier can never hang the orchestration.
  const hardStop = setTimeout(() => {
    trace("HARD TIMEOUT firing");
    console.error("VERIFIER HARD TIMEOUT");
    process.exit(3);
  }, 90000);
  hardStop.unref();

  trace("main start");
  const email = `e2e-${Date.now()}@example.com`;
  const slug = `e2e-site-${Date.now()}`;
  const password = "E2ePassw0rd!23";

  const reg = await req("POST", `${API}/api/auth/register`, {
    body: JSON.stringify({ email, password, displayName: "e2e" }),
    contentType: "application/json",
  });
  check("register user", reg.status === 201, `status=${reg.status}`);
  const cookie = (reg.setCookie || "").split(";")[0];
  check("received session cookie", !!cookie, `cookie=${cookie}`);

  const login = await req("POST", `${API}/api/auth/login`, {
    body: JSON.stringify({ email, password }),
    contentType: "application/json",
  });
  check("login", login.status === 200, `status=${login.status}`);
  const authCookie = (login.setCookie || cookie).split(";")[0];

  const createW = await req("POST", `${API}/api/websites`, {
    body: JSON.stringify({ name: "e2e", slug, description: "e2e" }),
    contentType: "application/json",
    cookie: authCookie,
  });
  check("create website", createW.status === 201, `status=${createW.status} body=${JSON.stringify(createW.data)}`);
  const websiteId = createW.data?.data?.id;
  check("website id present", !!websiteId);

  // Deploy v1 (retry in case the hosting node is still registering)
  const zip1 = makeZip([{ name: "index.html", data: "<h1>version one</h1>" }]);
  const mp1 = buildMultipart({ name: "site.zip", data: zip1, contentType: "application/zip" });
  const dep1 = await req("POST", `${API}/api/websites/${websiteId}/deployments`, {
    body: mp1.body, contentType: mp1.contentType, cookie: authCookie,
  });
  check("deploy v1 accepted", dep1.status === 202, `status=${dep1.status} body=${JSON.stringify(dep1.data)}`);
  const dep1Id = dep1.data?.data?.id;

  const ok1 = await waitFor(async () => {
    const r = await req("GET", `${API}/api/deployments/${dep1Id}`, { cookie: authCookie });
    return r.status === 200 && r.data?.data?.status === "SUCCESS";
  }, 60000, 2000, "v1");
  await trace(`v1 status now: ${(await req("GET", `${API}/api/deployments/${dep1Id}`, { cookie: authCookie })).data?.data?.status}`);
  check("v1 deploy reaches SUCCESS", ok1);
  const dep1Detail = await req("GET", `${API}/api/deployments/${dep1Id}`, { cookie: authCookie });
  check("v1 release number 1001", dep1Detail.data?.data?.releaseNumber === 1001, `rn=${dep1Detail.data?.data?.releaseNumber}`);

  const site1 = await req("GET", `${API}/api/websites/${websiteId}`, { cookie: authCookie });
  check("website ONLINE after v1", site1.data?.data?.status === "ONLINE", `status=${site1.data?.data?.status}`);
  check("website has currentReleaseId", !!site1.data?.data?.currentReleaseId);

  // Filesystem on the agent: release dir + current symlink
  const siteRoot = path.join(AGENT_STORAGE, "sites", slug);
  const rel1Dir = path.join(siteRoot, "releases", "1001");
  check("agent release dir exists", await fs.access(rel1Dir).then(() => true).catch(() => false));
  check("agent index.html present", await fs.access(path.join(rel1Dir, "index.html")).then(() => true).catch(() => false));
  const cur1 = await fs.readlink(path.join(siteRoot, "current")).catch(() => "");
  check("agent current symlink -> releases/1001", cur1.replace(/\\/g, "/").includes("releases/1001"), `cur=${cur1}`);

  // Deploy v2
  const zip2 = makeZip([{ name: "index.html", data: "<h1>version two</h1>" }]);
  const mp2 = buildMultipart({ name: "site.zip", data: zip2, contentType: "application/zip" });
  const dep2 = await req("POST", `${API}/api/websites/${websiteId}/deployments`, {
    body: mp2.body, contentType: mp2.contentType, cookie: authCookie,
  });
  const dep2Id = dep2.data?.data?.id;
  const ok2 = await waitFor(async () => {
    const r = await req("GET", `${API}/api/deployments/${dep2Id}`, { cookie: authCookie });
    return r.status === 200 && r.data?.data?.status === "SUCCESS";
  });
  check("v2 deploy reaches SUCCESS", ok2);
  const cur2 = await fs.readlink(path.join(siteRoot, "current")).catch(() => "");
  check("agent current symlink -> releases/1002", cur2.replace(/\\/g, "/").includes("releases/1002"), `cur=${cur2}`);

  // Rollback to v1
  const rb = await req("POST", `${API}/api/deployments/${dep1Id}/rollback`, { cookie: authCookie });
  check("rollback enqueued", rb.status === 202, `status=${rb.status}`);
  const okRb = await waitFor(async () => {
    const r = await req("GET", `${API}/api/websites/${websiteId}`, { cookie: authCookie });
    const d = await req("GET", `${API}/api/deployments/${dep1Id}`, { cookie: authCookie });
    const cur = r.data?.data?.currentReleaseId;
    const rel = d.data?.data?.releaseId;
    await trace(`rollback poll cur=${cur} dep1rel=${rel} status=${r.data?.data?.status}`);
    return cur === rel && r.data?.data?.status === "ONLINE";
  }, 60000, 2000, "rollback");
  check("rollback reverts current release to v1", okRb);
  const curRb = await fs.readlink(path.join(siteRoot, "current")).catch(() => "");
  check("agent current symlink back to releases/1001", curRb.replace(/\\/g, "/").includes("releases/1001"), `cur=${curRb}`);

  // Node security: agent token guard
  const noToken = await req("POST", `${AGENT}/v1/websites`, {
    body: JSON.stringify({ websiteId: "x", slug: "y", domains: [] }),
    contentType: "application/json",
  });
  check("agent rejects unauthenticated /v1", noToken.status === 403, `status=${noToken.status}`);
  const withToken = await req("POST", `${AGENT}/v1/websites`, {
    body: JSON.stringify({ websiteId: "x", slug: "y", domains: [] }),
    contentType: "application/json", token: AGENT_TOKEN,
  });
  check("agent accepts authenticated /v1", withToken.status === 201, `status=${withToken.status}`);

  console.log(`\nRESULT pass=${pass} fail=${fail}`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error("VERIFIER ERROR", e); process.exit(2); });
