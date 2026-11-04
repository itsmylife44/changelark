// End-to-end check of the backend: demo seed, SDK API, and RLS isolation.
// Needs `supabase start` and the app running. Usage: node scripts/check-backend.mjs [http://127.0.0.1:3000]
import assert from "node:assert/strict";

try { process.loadEnvFile(".env.local"); } catch {} // same settings as the app, if present
import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { emailLink } from "./mailpit.mjs";
import { createServer } from "node:http";

const BASE = process.argv[2] || "http://127.0.0.1:3000";
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const PUB = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const KEY = "clk_t1d3p00l7q"; // demo app
const fresh = () => createClient(URL, PUB, { auth: { persistSession: false } });

// Each run uses its own pretend IP, so the per-IP limits of one run don't leak into the next.
const RUN_IP = `198.51.100.${Math.floor(Math.random() * 250) + 1}`;
async function sdk(path, { method = "GET", body, anon, key = KEY, ip = RUN_IP, locale } = {}) {
  const res = await fetch(`${BASE}/api/v1/sdk${path}`, {
    method, body: body && JSON.stringify(body), redirect: "manual", // iOS stalls on redirected POSTs, so the API must answer directly
    headers: { "Content-Type": "application/json", "X-Changelark-App-Key": key, "X-Changelark-Anon-Id": anon, "X-Changelark-App-Version": "2.4", "X-Forwarded-For": ip, ...(locale ? { "X-Changelark-Locale": locale } : {}) },
  });
  return { status: res.status, data: await res.json() };
}

const step = (name) => console.log("✓", name);
const devA = "a" + randomBytes(12).toString("hex");
const devB = "b" + randomBytes(12).toString("hex");

// Demo workspace
const reset = await fetch(`${BASE}/api/demo`, { method: "POST" });
assert.equal(reset.status, 200);
step("demo workspace ready");

// Public app lookup
const pub = await (await fetch(`${BASE}/api/v1/public/tidepool`)).json();
assert.equal(pub.key, KEY);
assert.equal(pub.owner_id, undefined, "owner id must not leak");
step("public app page data, no owner id");

// SDK basics
assert.equal((await sdk("/config", { anon: devA, key: "sk_secret_123" })).status, 401);
assert.equal((await sdk("/config", { anon: "short" })).status, 400);
const cfg = await sdk("/config", { anon: devA });
assert.equal(cfg.status, 200);
assert.match(cfg.data.me.name, /^[A-Z][a-z]+-[0-9A-F]{4}$/);
step("rejects bad keys and install ids; anonymous name " + cfg.data.me.name);

const wn = await sdk("/whats-new?version=2.4.0", { anon: devA });
assert.equal(wn.data.state, "available");
assert.equal((await sdk("/whats-new?version=9.9", { anon: devA })).data.state, "unknown_version");
step("what's new: 2.4.0 matches 2.4, unknown versions reported");

// Votes: count once per device, toggle off with 0
const rel = wn.data.release;
const before = rel.upCount;
let v = await sdk("/votes", { method: "POST", anon: devA, body: { targetType: "release", targetId: rel.id, value: 1 } });
v = await sdk("/votes", { method: "POST", anon: devA, body: { targetType: "release", targetId: rel.id, value: 1 } });
assert.equal(v.data.upCount, before + 1, "same device votes once");
v = await sdk("/votes", { method: "POST", anon: devA, body: { targetType: "release", targetId: rel.id, value: -1 } });
assert.deepEqual([v.data.upCount, v.data.downCount], [before, rel.downCount + 1]);
v = await sdk("/votes", { method: "POST", anon: devA, body: { targetType: "release", targetId: rel.id, value: 0 } });
assert.deepEqual([v.data.upCount, v.data.downCount], [before, rel.downCount]);
step("votes: one per device, switch, clear");

// Comments: guidelines first, then post, reply, delete own only
assert.equal((await sdk("/releases/2.4/comments", { method: "POST", anon: devA, body: { body: "hi" } })).status, 403);
await sdk("/guidelines/accept", { method: "POST", anon: devA, body: {} });
await sdk("/guidelines/accept", { method: "POST", anon: devB, body: {} });
const c1 = await sdk("/releases/2.4/comments", { method: "POST", anon: devA, body: { body: "Love the new drag and drop" } });
assert.equal(c1.status, 201);
const c2 = await sdk("/releases/2.4/comments", { method: "POST", anon: devB, body: { body: "Same here", parentId: c1.data.id } });
assert.equal(c2.status, 201);
let list = (await sdk("/releases/2.4/comments", { anon: devA })).data.items;
const mine = list.find((c) => c.id === c1.data.id);
assert.equal(mine.author.isMe, true);
assert.equal(mine.replies[0].body, "Same here");
assert.equal((await sdk(`/comments/${c1.data.id}`, { method: "DELETE", anon: devB, body: {} })).status, 403);
step("comments: guidelines required, replies nest, can't delete others'");

// Pagination: threads come in pages, without overlap
{
  for (const n of [1, 2]) await sdk("/releases/2.4/comments", { method: "POST", anon: devB, body: { body: "page test " + n } });
  const all = (await sdk("/releases/2.4/comments?limit=100", { anon: devA })).data;
  assert.ok(all.items.length >= 3, "expected at least three threads");
  const p1 = (await sdk("/releases/2.4/comments?limit=1", { anon: devA })).data;
  assert.equal(p1.items.length, 1);
  if (all.items.length > 1) {
    assert.equal(p1.nextCursor, "1");
    const p2 = (await sdk(`/releases/2.4/comments?limit=1&cursor=${p1.nextCursor}`, { anon: devA })).data;
    assert.notEqual(p2.items[0].id, p1.items[0].id);
  }
  const rels = (await sdk("/releases?limit=1", { anon: devA })).data;
  assert.equal(rels.items.length, 1);
  assert.equal(rels.nextCursor, "1", "the demo app has three versions");
  step("pagination: comment threads and releases come in pages");
}

// Comment votes and a removed comment
v = await sdk("/votes", { method: "POST", anon: devB, body: { targetType: "comment", targetId: c1.data.id, value: 1 } });
assert.equal(v.data.upCount, 1);
step("comment votes");

// Report and block hide things only for that device
await sdk("/reports", { method: "POST", anon: devB, body: { targetId: c1.data.id, reason: "spam" } });
list = (await sdk("/releases/2.4/comments", { anon: devB })).data.items;
assert.ok(!list.some((c) => c.id === c1.data.id), "reported comment hidden for reporter");
list = (await sdk("/releases/2.4/comments", { anon: devA })).data.items;
assert.ok(list.some((c) => c.id === c1.data.id), "still visible for others");
await sdk("/blocks", { method: "POST", anon: devA, body: { commentId: c2.data.id } });
list = (await sdk("/releases/2.4/comments", { anon: devA })).data.items;
assert.equal(list.find((c) => c.id === c1.data.id).replies.length, 0, "blocked author hidden");
step("report and block hide per device");

// Rate limit
let last;
for (let i = 0; i < 6; i++) last = await sdk("/releases/2.4/comments", { method: "POST", anon: devA, body: { body: "spam " + i } });
assert.equal(last.status, 429);
step("rate limit: 5 comments a minute per install");

// Per-IP limit: many installs behind one address still get stopped
{
  const ip = `203.0.113.${Math.floor(Math.random() * 250) + 1}`;
  let last;
  for (let i = 0; i < 31; i++) {
    const anon = "ipcheck" + i + randomBytes(8).toString("hex");
    await sdk("/guidelines/accept", { method: "POST", anon, ip, body: {} });
    last = await sdk("/releases/2.4/comments", { method: "POST", anon, ip, body: { body: "from one network " + i } });
    if (i < 30) assert.equal(last.status, 201, `comment ${i} from a shared IP was refused early`);
  }
  assert.equal(last.status, 429);
  assert.equal(last.data.error.code, "slow_down");
  const other = await sdk("/releases/2.4/comments", { method: "POST", anon: devB, body: { body: "different network" } });
  assert.equal(other.status, 201, "other networks must not be affected");
  step("per-IP limit: 30 comments a minute per network, others unaffected");
}

// Delete own
assert.equal((await sdk(`/comments/${c2.data.id}`, { method: "DELETE", anon: devB, body: {} })).status, 200);
list = (await sdk("/releases/2.4/comments", { anon: devA })).data.items;
step("delete own comment");

// ---------- RLS ----------
const anonDb = fresh();
for (const t of ["apps", "releases", "comments", "reports", "votes", "installs"]) {
  const { data, error } = await anonDb.from(t).select("*").limit(1);
  assert.ok(error || data.length === 0, `anon must not read ${t}`);
}
step("anonymous Data API reads nothing");

const demo = fresh();
assert.ok(!(await demo.auth.signInWithPassword({ email: "demo@changelark.example", password: "demo1234" })).error);
const { data: demoApps } = await demo.from("apps").select("id, slug");
assert.equal(demoApps.length, 4);
const { data: demoComments } = await demo.from("comments").select("id, author_tag");
assert.ok(demoComments.length >= 2, "owner sees comments on own app");
const { data: reports } = await demo.from("reports").select("*");
assert.ok(reports.some((r) => r.comment_id === c1.data.id), "owner sees reports");
assert.ok((await demo.from("releases").update({ up_count: 9999 }).eq("version", "2.4")).error, "counters are read-only");
assert.ok((await demo.from("comments").insert({ release_id: wn.data.release.id, body: "x", author_name: "Fake", is_dev: false })).error, "owner can't post as anonymous");
assert.ok(!(await demo.from("comments").update({ hidden: true }).eq("id", c1.data.id)).error, "owner hides");
list = (await sdk("/releases/2.4/comments", { anon: devA })).data.items;
assert.equal(list.find((c) => c.id === c1.data.id).status, "hidden");
step("owner reads own data, hides comments; counters and anonymous posts are off-limits");

// Developer replies reach the person who commented: counted once, only for them, older ones count as read.
{
  const devC = "c" + randomBytes(12).toString("hex");
  const ip = "203.0.113.9";
  const replies = async (since, anon = devC) => (await sdk(`/new-replies${since ? `?since=${encodeURIComponent(since)}` : ""}`, { anon, ip })).data;
  await sdk("/guidelines/accept", { method: "POST", anon: devC, ip, body: {} });
  const q = await sdk("/releases/2.4/comments", { method: "POST", anon: devC, ip, body: { body: "Does the widget work offline?" } });
  const reply = (body) => demo.from("comments").insert({ release_id: wn.data.release.id, parent_id: q.data.id, body, author_name: "Noor Haddad", is_dev: true });
  assert.ok(!(await reply("Yes, it caches the last forecast.")).error);
  const first = await replies(null);
  assert.equal(first.count, 0, "first check: earlier replies count as read");
  assert.equal((await replies(first.checkedAt)).count, 0);
  assert.ok(!(await reply("And it refreshes when you're back online.")).error);
  const next = await replies(first.checkedAt);
  assert.deepEqual([next.count, next.version], [1, "2.4"]);
  assert.equal((await replies(next.checkedAt)).count, 0, "seen replies don't come back");
  assert.equal((await replies(first.checkedAt, devA)).count, 0, "only the commenter is told");
}
step("developer replies are counted once for the person who commented");

const other = fresh();
const email = `check-${randomBytes(4).toString("hex")}@example.com`;
const su = await other.auth.signUp({ email, password: "check-pass-123", options: { data: { name: "Checker" } } });
assert.equal(su.data.session, null, "no session before the email is confirmed");
assert.ok((await other.auth.signInWithPassword({ email, password: "check-pass-123" })).error, "can't sign in unconfirmed");
const confirm = await fetch(await emailLink(email, "email"), { redirect: "manual" });
assert.equal(new globalThis.URL(confirm.headers.get("location"), BASE).pathname, "/", "confirmation link should land on the workspace");
assert.ok(!(await other.auth.signInWithPassword({ email, password: "check-pass-123" })).error, "can sign in after confirming");
step("signup needs email confirmation; the emailed link confirms");
assert.equal((await other.from("apps").select("id")).data.length, 0, "other user sees no demo apps");
assert.equal((await other.from("comments").select("id")).data.length, 0);
const upd = await other.from("apps").update({ name: "pwned" }).eq("id", demoApps[0].id).select();
assert.equal(upd.data.length, 0, "can't edit someone else's app");
const steal = await other.from("releases").insert({ app_id: demoApps[0].id, version: "9.9", notes: "x" });
assert.ok(steal.error, "can't add releases to someone else's app");
const own = await other.from("apps").insert({ slug: "check-" + randomBytes(3).toString("hex"), name: "Mine", key: "clk_" + randomBytes(8).toString("hex") }).select().single();
assert.ok(!own.error, own.error?.message);
assert.ok((await other.from("apps").insert({ slug: "login", name: "Bad", key: "clk_" + randomBytes(8).toString("hex") })).error, "reserved slug refused");
await other.from("apps").delete().eq("id", own.data.id);
step("other accounts are isolated; reserved slugs refused");

assert.equal((await fetch(`${BASE}/api/account`, { method: "DELETE", body: "{}" })).status, 401, "account delete needs a session");
step("account deletion refused without a session");

const resetAsOther = await fetch(`${BASE}/api/demo`, { method: "POST", body: JSON.stringify({ reset: true }) });
assert.equal(resetAsOther.status, 403);
step("demo reset refused without the demo session");

// ---------- the feedback loop: translations, RSS, webhooks, bug reports ----------
{
  const rel24 = wn.data.release;
  assert.ok(!(await demo.from("releases").update({ translations: { it: "Grafici delle maree rifatti.", "pt-br": "Gráficos de maré refeitos." } }).eq("id", rel24.id)).error, "owner sets translations");
  const it = (await sdk("/whats-new?version=2.4", { anon: devA, locale: "it-IT" })).data.release;
  assert.equal(it.notes, "Grafici delle maree rifatti.");
  assert.equal(it.language, "it");
  assert.deepEqual(it.languages, ["it", "pt-br"]);
  assert.equal((await sdk("/whats-new?version=2.4", { anon: devA, locale: "pt-BR" })).data.release.language, "pt-br");
  const en = (await sdk("/whats-new?version=2.4", { anon: devA, locale: "fr-FR" })).data.release;
  assert.equal(en.language, null, "no French translation: original notes");
  const page = await (await fetch(`${BASE}/apps/tidepool?lang=it`)).text();
  assert.ok(page.includes("Grafici delle maree rifatti."), "public page in Italian");
  step("translations: the phone's language picks the notes, original otherwise");

  const rss = await fetch(`${BASE}/apps/tidepool/feed.xml`);
  assert.equal(rss.status, 200);
  assert.match(rss.headers.get("content-type"), /rss\+xml/);
  const xml = await rss.text();
  assert.equal((xml.match(/<item>/g) || []).length, 3, "three published versions in the feed");
  assert.ok(xml.includes("<title>Tidepool: Tides &amp; Surf 2.4</title>"), "titles are escaped");
  assert.equal((await fetch(`${BASE}/apps/no-such-app/feed.xml`)).status, 404);
  step("RSS feed lists published versions");

  // A pretend Slack: the server must be started with WEBHOOK_ALLOW_LOCAL=1 for a local address.
  const hits = [];
  const hook = createServer((req, res) => { let b = ""; req.on("data", (d) => (b += d)); req.on("end", () => { hits.push(JSON.parse(b)); res.end("ok"); }); });
  await new Promise((r) => hook.listen(4012, "127.0.0.1", r));
  const appId = demoApps.find((a) => a.slug === "tidepool").id;
  assert.ok((await demo.from("apps").update({ webhook_url: "ftp://nope" }).eq("id", appId)).error, "only http(s) webhooks");
  assert.ok(!(await demo.from("apps").update({ webhook_url: "http://127.0.0.1:4012/hook" }).eq("id", appId)).error);
  const pub = await (await fetch(`${BASE}/api/v1/public/tidepool`)).json();
  assert.equal(pub.webhook_url, undefined, "webhook address never public");
  const devC = "c" + randomBytes(12).toString("hex");
  await sdk("/guidelines/accept", { method: "POST", anon: devC, body: {} });
  await sdk("/releases/2.4/comments", { method: "POST", anon: devC, body: { body: "Webhook check <b>bold</b>" } });
  for (let i = 0; i < 40 && !hits.length; i++) await new Promise((r) => setTimeout(r, 100));
  assert.ok(hits.length >= 1, "webhook not called for a new comment");
  assert.equal(hits[0].event, "comment");
  assert.ok(hits[0].text.includes("Webhook check") && hits[0].text.includes("Tidepool"), hits[0].text);
  step("webhook: new comments are posted to the app's webhook; address stays private");

  // Bug reports: private, with a screenshot in private storage.
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
  assert.equal((await sdk("/bugs", { method: "POST", anon: devC, body: { body: "x", version: "2.4", screenshot: Buffer.from("not an image").toString("base64") } })).status, 400, "non-image refused");
  assert.equal((await sdk("/bugs", { method: "POST", anon: devC, body: { body: "", version: "2.4" } })).status, 400, "empty report refused");
  const bug = await sdk("/bugs", { method: "POST", anon: devC, body: { body: "Chart freezes on swipe", version: "2.4", device: "iPhone, iOS 26", screenshot: png.toString("base64") } });
  assert.equal(bug.status, 201, JSON.stringify(bug.data));
  for (let i = 0; i < 40 && !hits.some((h) => h.event === "bug"); i++) await new Promise((r) => setTimeout(r, 100));
  assert.ok(hits.some((h) => h.event === "bug" && h.text.includes("with screenshot")), "webhook not called for the bug");
  const mineBugs = (await demo.from("bug_reports").select("*").eq("id", bug.data.id)).data;
  assert.equal(mineBugs.length, 1, "owner reads the bug report");
  assert.equal(mineBugs[0].device, "iPhone, iOS 26");
  const signed = await demo.storage.from("screenshots").createSignedUrl(mineBugs[0].screenshot_path, 60);
  assert.ok(!signed.error, signed.error?.message);
  const img = Buffer.from(await (await fetch(signed.data.signedUrl)).arrayBuffer());
  assert.ok(img.equals(png), "screenshot comes back intact");
  assert.equal((await other.from("bug_reports").select("id")).data.length, 0, "other accounts can't read bug reports");
  assert.ok((await other.storage.from("screenshots").createSignedUrl(mineBugs[0].screenshot_path, 60)).error, "other accounts can't open the screenshot");
  assert.equal((await fresh().from("bug_reports").select("id")).data?.length ?? 0, 0, "anonymous can't read bug reports");
  assert.ok(!(await demo.from("bug_reports").update({ resolved: true }).eq("id", bug.data.id)).error, "owner marks it fixed");
  await demo.from("apps").update({ webhook_url: null }).eq("id", appId);
  hook.close();
  step("bug reports: private to the owner, screenshot in private storage, webhook notified");
}

console.log("\nAll backend checks passed.");
