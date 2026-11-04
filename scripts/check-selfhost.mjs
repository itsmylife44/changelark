// Checks of the Docker setup. Run it on the server, next to docker-compose.yml and .env.
// Usage: node scripts/check-selfhost.mjs
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { connect } from "node:net";
import { networkInterfaces } from "node:os";

try { process.loadEnvFile(".env"); } catch {} // same settings as the stack, if present
const step = (name) => console.log("✓", name);
const compose = (...args) => execFileSync("docker", ["compose", ...args], { encoding: "utf8" });

// Cron: without SMTP_URL the alerts route is never called
const out = compose("run", "--rm", "--no-deps", "-e", "SMTP_URL=", "-e", "APP_URL=http://127.0.0.1:9", "cron", "/cron/run.sh", "alerts");
assert.match(out, /alerts skipped/);
assert.doesNotMatch(out, /FAILED/, "alerts route must not be called without SMTP_URL");
step("cron skips alerts without SMTP_URL");

// The rest is for Supabase in the same Docker (docker-compose.supabase.yml).
if (!(process.env.COMPOSE_FILE || "").includes("docker-compose.supabase.yml")) process.exit(0);
const SITE = process.env.NEXT_PUBLIC_SUPABASE_URL;
const PUB = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const KONG = Number(process.env.KONG_HTTP_PORT || 8000);
const PG = Number(process.env.POSTGRES_PORT || 5432);

// true if something accepts a TCP connection on host:port within 2 s
const open = (host, port) => new Promise((done) => {
  const s = connect({ host, port, timeout: 2000 });
  s.on("connect", () => { s.destroy(); done(true); });
  s.on("error", () => done(false));
  s.on("timeout", () => { s.destroy(); done(false); });
});

// Studio sits behind the gateway's basic auth on "/".
const local = await fetch(`http://127.0.0.1:${KONG}/`);
assert.equal(local.status, 401, "Studio should ask for DASHBOARD_USERNAME/PASSWORD on 127.0.0.1");
step(`Studio answers on 127.0.0.1:${KONG}`);

// The server's own non-loopback addresses, plus its public name: behind NAT the public address
// isn't on any interface, so PUBLIC_HOST (default DOMAIN) is probed too.
const publicHost = process.env.PUBLIC_HOST || process.env.DOMAIN;
const probed = Object.values(networkInterfaces()).flat().filter((i) => i && !i.internal && i.family === "IPv4").map((i) => i.address);
if (publicHost) probed.push(publicHost);
assert.ok(probed.length, "no non-loopback network interface found; set PUBLIC_HOST to the server's public IP or name");
for (const host of probed) {
  assert.equal(await open(host, KONG), false, `the gateway (and Studio) is reachable on ${host}:${KONG}`);
  assert.equal(await open(host, PG), false, `Postgres is reachable on ${host}:${PG}`);
}
step(`Studio not reachable from outside, nor Postgres (probed ${probed.join(", ")}; set PUBLIC_HOST to probe another address)`);

const site = await fetch(`${SITE}/`, { redirect: "manual" });
assert.ok(!/basic/i.test(site.headers.get("www-authenticate") || ""), `${SITE}/ shows Studio's login`);
step(`${SITE}/ is the site, not Studio`);

const health = await fetch(`${SITE}/auth/v1/health`, { headers: { apikey: PUB } });
assert.equal(health.status, 200, `${SITE}/auth/v1/health answered ${health.status}`);
step(`Supabase API answers at ${SITE} with the publishable key`);

// Auth reads Changelark's email templates from the app, at the URLs in compose.override.yml.
for (const name of ["confirmation", "recovery"]) {
  const html = compose("exec", "-T", "auth", "wget", "-qO-", `http://app:3000/email-templates/${name}.html`);
  assert.match(html, /\/auth\/confirm\?token_hash=\{\{ \.TokenHash \}\}/, `${name} template`);
}
step("Auth gets the email templates from the app");
if (process.env.ENABLE_EMAIL_AUTOCONFIRM === "false") assert.ok(process.env.SMTP_URL, "ENABLE_EMAIL_AUTOCONFIRM=false without SMTP: nobody could confirm an email");

// The first account from setup.sh signs in. Its password is not in .env: pass it in.
const { ADMIN_EMAIL, ADMIN_PASSWORD } = process.env;
if (ADMIN_EMAIL && ADMIN_PASSWORD) {
  const res = await fetch(`${SITE}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: { apikey: PUB, "content-type": "application/json" },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  });
  const body = await res.json();
  assert.equal(res.status, 200, `${ADMIN_EMAIL} cannot sign in: ${JSON.stringify(body)}`);
  assert.ok(body.access_token);
  step(`first account ${ADMIN_EMAIL} signs in`);
} else console.log("- first account sign-in skipped: run with ADMIN_EMAIL=... ADMIN_PASSWORD=...");

// Sign-up is closed unless .env says DISABLE_SIGNUP=false.
const signup = await fetch(`${SITE}/auth/v1/signup`, {
  method: "POST", headers: { apikey: PUB, "content-type": "application/json" },
  body: JSON.stringify({ email: `check-${Date.now()}@example.com`, password: "check-pass-123" }),
});
const signupBody = await signup.json();
if (process.env.DISABLE_SIGNUP === "false") {
  assert.equal(signup.status, 200, `sign-up should be open: ${JSON.stringify(signupBody)}`);
  const id = signupBody.user?.id ?? signupBody.id; // remove the test account again
  assert.ok(id, `sign-up answered without a user id: ${JSON.stringify(signupBody)}`);
  const del = await fetch(`${SITE}/auth/v1/admin/users/${id}`, { method: "DELETE", headers: { apikey: process.env.SUPABASE_SECRET_KEY } });
  assert.ok(del.ok, `could not remove the test account ${id}: ${del.status} ${await del.text()}`);
  step("sign-up is open (DISABLE_SIGNUP=false)");
} else {
  assert.equal(signupBody.error_code, "signup_disabled", `a stranger could sign up: ${JSON.stringify(signupBody)}`);
  step("sign-up is closed");
}

// Backup: run it now (as cron does each night) and look inside the new archive.
const ran = compose("exec", "-T", "cron", "/cron/backup.sh");
const archive = ran.match(/backup ok: (\S+)/)?.[1];
assert.ok(archive, `backup failed: ${ran}`);
const parts = compose("exec", "-T", "cron", "tar", "-tzf", archive).split("\n").map((l) => l.replace(/^\.\//, ""));
for (const part of ["db.dump", "db-config/pgsodium_root.key", "storage/", ".env"])
  assert.ok(parts.includes(part), `${part} missing from ${archive}`);
step(`backup ${archive} has the database dump, db-config (Vault key), storage and .env`);
