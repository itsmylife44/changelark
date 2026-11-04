// Run: node --test scripts/setup.test.mjs (downloads Supabase's scripts for the pinned tag).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const setup = (file) => spawnSync("sh", ["scripts/setup.sh"], { env: { ...process.env, SETUP_TEST_ENV_FILE: file, DOMAIN: "afw.example" }, input: "", encoding: "utf8" });
const parse = (file) => Object.fromEntries(readFileSync(file, "utf8").split("\n").filter((l) => /^[A-Z_0-9]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
const fresh = () => join(mkdtempSync(join(tmpdir(), "afw-setup-")), "env");

test("writes secrets, sb_ keys and the self-hosted URLs", () => {
  const file = fresh();
  const run = setup(file);
  assert.equal(run.status, 0, run.stderr);
  const env = parse(file);
  assert.match(env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, /^sb_publishable_/);
  assert.match(env.SUPABASE_SECRET_KEY, /^sb_secret_/);
  assert.equal(env.SUPABASE_PUBLISHABLE_KEY, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
  assert.ok(env.JWT_KEYS.startsWith("[") && env.JWT_JWKS.startsWith("{"));
  assert.match(env.POSTGRES_PASSWORD, /^[0-9a-f]{32}$/);
  assert.match(env.CRON_SECRET, /^[0-9a-f]{64}$/);
  assert.ok(env.JWT_SECRET.length >= 40);
  assert.equal(env.NEXT_PUBLIC_SUPABASE_URL, "https://afw.example");
  assert.equal(env.SUPABASE_PUBLIC_URL, "https://afw.example");
  assert.equal(env.API_EXTERNAL_URL, "https://afw.example");
  assert.equal(env.SITE_URL, "https://afw.example");
  assert.equal(env.COMPOSE_FILE, "docker-compose.yml:docker-compose.supabase.yml");
  // every key appears once
  const names = readFileSync(file, "utf8").split("\n").filter((l) => /^[A-Z_0-9]+=/.test(l)).map((l) => l.split("=")[0]);
  assert.equal(names.length, new Set(names).size);
});

test("a second run keeps every existing value and the user's own lines", () => {
  const file = fresh();
  writeFileSync(file, "# mine\nCRON_SECRET=keepme\n");
  assert.equal(setup(file).status, 0);
  const first = readFileSync(file, "utf8");
  const run = setup(file);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(readFileSync(file, "utf8"), first);
  assert.equal(parse(file).CRON_SECRET, "keepme");
});

test("refuses to mix with keys of another Supabase (Cloud)", () => {
  const file = fresh();
  const cloud = "NEXT_PUBLIC_SUPABASE_URL=https://ref.supabase.co\nSUPABASE_SECRET_KEY=sb_secret_cloud\n";
  writeFileSync(file, cloud);
  const run = setup(file);
  assert.notEqual(run.status, 0);
  assert.match(run.stderr + run.stdout, /SUPABASE_SECRET_KEY/);
  assert.equal(readFileSync(file, "utf8"), cloud);
});

test("closes sign-up by default", () => {
  const file = fresh();
  assert.equal(setup(file).status, 0);
  assert.equal(parse(file).DISABLE_SIGNUP, "true");
});

test("without SMTP, accounts are confirmed automatically", () => {
  const file = fresh();
  assert.equal(setup(file).status, 0);
  const env = parse(file);
  assert.equal(env.ENABLE_EMAIL_AUTOCONFIRM, "true");
  assert.equal(env.SMTP_URL, undefined);
});

const smtp = { SMTP_HOST: "smtp.resend.com", SMTP_PORT: "465", SMTP_USER: "re$end", SMTP_PASS: "p@ss:w/rd$x", SMTP_ADMIN_EMAIL: "hello@afw.example" };
const setupSmtp = (file) => spawnSync("sh", ["scripts/setup.sh"], { env: { ...process.env, SETUP_TEST_ENV_FILE: file, DOMAIN: "afw.example", ...smtp }, input: "", encoding: "utf8" });

test("with SMTP, Auth sends confirmation emails through it and the app gets SMTP_URL", () => {
  const file = fresh();
  const run = setupSmtp(file);
  assert.equal(run.status, 0, run.stderr);
  const env = parse(file);
  assert.equal(env.ENABLE_EMAIL_AUTOCONFIRM, "false");
  for (const [k, v] of Object.entries(smtp)) assert.equal(env[k].replace(/^'(.*)'$/, "$1"), v, k); // quoted, so Compose leaves a $ alone
  for (const k of ["SMTP_HOST", "SMTP_USER", "SMTP_PASS"]) assert.match(env[k], /^'.*'$/, `${k} is single-quoted`);
  assert.equal(env.SMTP_SENDER_NAME, "Changelark");
  assert.equal(env.EMAIL_FROM, "Changelark <hello@afw.example>");
  assert.equal(env.ADDITIONAL_REDIRECT_URLS, "https://afw.example/**");
  // Port 465 is implicit TLS; the password stays intact once nodemailer decodes the URL.
  const u = new URL(env.SMTP_URL);
  assert.equal(u.protocol, "smtps:");
  assert.equal(u.host, "smtp.resend.com:465");
  assert.equal(decodeURIComponent(u.username), "re$end");
  assert.equal(decodeURIComponent(u.password), "p@ss:w/rd$x");
});

test("a later run with SMTP turns email on and leaves every other value alone", () => {
  const file = fresh();
  assert.equal(setup(file).status, 0);
  const before = parse(file);
  const run = setupSmtp(file);
  assert.equal(run.status, 0, run.stderr);
  const after = parse(file);
  assert.equal(after.ENABLE_EMAIL_AUTOCONFIRM, "false");
  assert.equal(after.SMTP_HOST, "'smtp.resend.com'");
  assert.ok(after.SMTP_URL);
  const mail = new Set(["ENABLE_EMAIL_AUTOCONFIRM", "SMTP_URL", "EMAIL_FROM", ...Object.keys(smtp), "SMTP_SENDER_NAME"]);
  for (const [k, v] of Object.entries(before)) if (!mail.has(k)) assert.equal(after[k], v, k);
  const names = readFileSync(file, "utf8").split("\n").filter((l) => /^[A-Z_0-9]+=/.test(l)).map((l) => l.split("=")[0]);
  assert.equal(names.length, new Set(names).size, "every key appears once");
  // and a plain run afterwards keeps the SMTP settings
  assert.equal(setup(file).status, 0);
  assert.deepEqual(parse(file), after);
});

// A stand-in for Supabase Auth behind the gateway: health, list and create users.
async function fakeAuth() {
  const users = [], keys = [];
  const server = createServer((req, res) => {
    keys.push(req.headers.apikey);
    const send = (status, body) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
    if (req.url === "/auth/v1/health") return send(200, {});
    if (req.url.startsWith("/auth/v1/admin/users") && req.method === "GET") return send(200, { users });
    if (req.url === "/auth/v1/admin/users" && req.method === "POST") {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => { const u = JSON.parse(raw); users.push(u); send(200, { id: String(users.length), email: u.email }); });
      return;
    }
    send(404, {});
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  return { users, keys, port: server.address().port, close: () => server.close() };
}
const setupAsync = (file, env) => new Promise((done) => {
  const p = spawn("sh", ["scripts/setup.sh"], { env: { ...process.env, SETUP_TEST_ENV_FILE: file, DOMAIN: "afw.example", ...env }, stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  p.stdout.on("data", (c) => (out += c));
  p.stderr.on("data", (c) => (out += c));
  p.on("close", (status) => done({ status, out }));
});

test("creates the first account, confirmed, and leaves it alone on a second run", async () => {
  const auth = await fakeAuth();
  try {
    const file = fresh();
    writeFileSync(file, `KONG_HTTP_PORT=${auth.port}\n`);
    const admin = { ADMIN_EMAIL: "me@afw.example", ADMIN_PASSWORD: 'pa"ss\\word-1' };
    const run = await setupAsync(file, admin);
    assert.equal(run.status, 0, run.out);
    assert.equal(auth.users.length, 1, run.out);
    assert.deepEqual(auth.users[0], { email: "me@afw.example", password: 'pa"ss\\word-1', email_confirm: true });
    assert.ok(auth.keys.includes(parse(file).SUPABASE_SECRET_KEY), "admin calls use the secret key");
    assert.doesNotMatch(readFileSync(file, "utf8"), /word-1/, "the password is not written to .env");

    const again = await setupAsync(file, admin);
    assert.equal(again.status, 0, again.out);
    assert.equal(auth.users.length, 1, "no second account");
  } finally { auth.close(); }
});

test("without a terminal or ADMIN_EMAIL, says how to create the account later", async () => {
  const auth = await fakeAuth();
  try {
    const file = fresh();
    writeFileSync(file, `KONG_HTTP_PORT=${auth.port}\n`);
    const run = await setupAsync(file, {});
    assert.equal(run.status, 0, run.out);
    assert.equal(auth.users.length, 0);
    assert.match(run.out, /ADMIN_EMAIL/);
  } finally { auth.close(); }
});

test("ADMIN_EMAIL without ADMIN_PASSWORD and no terminal fails with a clear message", async () => {
  const auth = await fakeAuth();
  try {
    const file = fresh();
    writeFileSync(file, `KONG_HTTP_PORT=${auth.port}\n`);
    const run = await setupAsync(file, { ADMIN_EMAIL: "me@afw.example" });
    assert.notEqual(run.status, 0);
    assert.match(run.out, /ADMIN_PASSWORD/);
    assert.doesNotMatch(run.out, /stty/);
    assert.equal(auth.users.length, 0);
  } finally { auth.close(); }
});

test("refuses an email or password with control characters", async () => {
  const auth = await fakeAuth();
  try {
    const file = fresh();
    writeFileSync(file, `KONG_HTTP_PORT=${auth.port}\n`);
    const run = await setupAsync(file, { ADMIN_EMAIL: "me@afw.example", ADMIN_PASSWORD: "pass\tword-1" });
    assert.notEqual(run.status, 0);
    assert.match(run.out, /control character/);
    assert.equal(auth.users.length, 0);
  } finally { auth.close(); }
});

