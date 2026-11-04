// Full click-through of the app in a real browser: developer, two anonymous visitors, a new account.
// Needs `supabase start` and the app running. Usage: node scripts/check-ui.mjs [http://127.0.0.1:3000]
// Every step runs even if an earlier one fails; the summary lists what broke.
import { chromium } from "playwright";
import { emailLink, messagesTo, messageHtml } from "./mailpit.mjs";
import { startMockAsc } from "./mock-asc.mjs";
import { execFileSync, spawn } from "node:child_process";
import { cpSync, existsSync } from "node:fs";

// App Store Connect steps need the app started with ASC_API_URL=http://127.0.0.1:4010 and CRON_SECRET set (see README).
const asc = await startMockAsc(4010);
const CRON_SECRET = process.env.CRON_SECRET || "local-cron";
// Counts App Store Connect keys in Supabase Vault (local database only).
const vaultKeys = () => +execFileSync("psql", [process.env.DB_URL || "postgresql://postgres:postgres@127.0.0.1:54322/postgres", "-tAc", "select count(*) from vault.secrets where name like 'asc-key-%'"]).toString().trim();

const BASE = process.argv[2] || "http://127.0.0.1:3000";
const T = 8000;
const results = [];
const problems = [];
const expected4xx = [];

async function step(name, fn) {
  try { await fn(); results.push(["✓", name]); console.log("✓", name); }
  catch (e) { results.push(["✗", name, e.message.split("\n")[0]]); console.log("✗", name, "—", e.message.split("\n")[0]); }
}
function ok(cond, msg) { if (!cond) throw new Error(msg); }

const browser = await chromium.launch();
async function ctx(label) {
  const c = await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"] });
  c.setDefaultTimeout(T);
  const p = await c.newPage();
  p.on("dialog", (d) => d.accept());
  p.on("pageerror", (e) => problems.push(`[${label}] page error: ${e.message}`));
  p.on("console", (m) => { if (m.type() === "error" && !m.text().startsWith("Failed to load resource")) problems.push(`[${label}] console: ${m.text()}`); });
  p.on("response", async (r) => {
    if (r.status() >= 500) problems.push(`[${label}] ${r.status()} ${r.url()}`);
    else if (r.status() >= 400) expected4xx.push(`[${label}] ${r.status()} ${r.request().method()} ${r.url().replace(BASE, "")} ${(await r.text().catch(() => "")).slice(0, 90)}`);
  });
  return p;
}
const dev = await ctx("developer");
const v1 = await ctx("visitor1");
const v2 = await ctx("visitor2");
const text = (p, sel) => p.locator(sel).first().innerText({ timeout: T });
const panel = (p, title) => p.locator(".panel", { has: p.locator("h1, h2, h3", { hasText: title }) });
const toast = (p, t) => p.locator(".toast", { hasText: t }).waitFor({ timeout: T });
const go = async (p, hash) => { await p.goto(`${BASE}/${hash}`); await p.waitForLoadState("networkidle"); };
// The account menu in the top bar holds Log out, Reset demo and Account.
const menu = async (p, item) => { await p.locator("summary[aria-label='Account menu']").click(); await p.locator(".menu-pop").getByRole(item === "Account" ? "link" : "button", { name: item, exact: true }).click(); };
const appOptions = (p) => p.locator(".app-switch select option").evaluateAll((os) => os.map((o) => o.textContent).filter((t) => !t.startsWith("+") && t !== "Choose an app"));
const versions = (p) => p.locator(".version-item .v").allInnerTexts();

// ---------- developer: demo workspace ----------
await step("start address opens the demo workspace on its first app", async () => {
  await go(dev, "");
  await dev.locator(".version-item").first().waitFor();
  ok((await text(dev, ".side-user")) === "Noor Haddad", "wrong user name");
});
await step("reset demo", async () => {
  await menu(dev, "Reset demo");
  await toast(dev, "Demo reset");
  ok((await appOptions(dev)).length === 4, "expected 4 apps");
});

// ---------- malformed hash ----------
await step("a malformed hash opens the default view without a page error", async () => {
  const before = problems.length;
  await go(dev, "#%E0");
  await dev.locator(".version-item").first().waitFor();
  const errors = problems.slice(before).filter((m) => m.includes("page error"));
  ok(!errors.length, errors[0]);
});

// ---------- apps ----------
await step("connect an app; an empty app opens on its first version", async () => {
  await go(dev, "#connect");
  await dev.getByLabel("App name").fill("QA App");
  await dev.getByLabel("Description").fill("An app for testing.");
  await dev.getByLabel("App Store link").fill("https://apps.apple.com/app/id1");
  await dev.getByLabel("Contact link").fill("mailto:qa@example.com");
  await dev.getByRole("button", { name: "#FF2D55" }).click();
  await dev.getByRole("button", { name: "Add app" }).click();
  await dev.waitForURL(/#app\/qa-app$/);
  await dev.locator("h1", { hasText: "Your first version" }).waitFor();
  ok((await dev.locator(".app-switch select").inputValue()) === "qa-app", "switcher doesn't show the new app");
});

async function addRelease(version, notes, { publish = true, date } = {}) {
  await go(dev, "#app/qa-app/new");
  const f = dev.locator(".editor-form");
  await f.getByLabel("Version").fill(version);
  if (date) await f.getByLabel("Release date").fill(date);
  await f.getByLabel("Release notes").fill(notes);
  const box = f.getByLabel("Publish now");
  if ((await box.isChecked()) !== publish) await box.click();
  await f.getByRole("button", { name: "Add version" }).click();
}

await step("version form rejects a bad version", async () => {
  await addRelease("abc", "x");
  ok((await text(dev, ".form-error")).includes("version number"), "no version error");
});
await step("version form rejects empty notes", async () => {
  await addRelease("1.0", "  ");
  ok((await text(dev, ".form-error")).includes("release notes"), "no notes error");
});
await step("add published version 1.0; it opens in the editor", async () => {
  await addRelease("1.0", "First version.\n\n- Lists\n- Notes");
  await toast(dev, "Version 1.0 published");
  await dev.waitForURL(/#app\/qa-app\/1\.0$/);
  await dev.locator(".version-item[aria-current='page'] .v", { hasText: "1.0" }).waitFor();
});
await step("duplicate version refused", async () => {
  await addRelease("1.0", "again");
  await dev.locator(".form-error", { hasText: "already exists" }).waitFor();
});
await step("add draft 1.1 and future-dated 2.0", async () => {
  await addRelease("1.1", "Draft notes.", { publish: false });
  await toast(dev, "saved as draft");
  await addRelease("2.0", "Future notes.", { date: "2099-01-01" });
  await toast(dev, "Version 2.0 published");
  ok(/draft/i.test(await text(dev, ".version-item:has(.v:text-is('1.1'))")), "1.1 not a draft");
});
await step("edit app details in Settings", async () => {
  await go(dev, "#settings/qa-app");
  await panel(dev, "App details").getByLabel("App name").fill("QA App Renamed");
  await dev.getByRole("button", { name: "Save changes" }).click();
  await toast(dev, "Saved");
  ok((await appOptions(dev)).includes("QA App Renamed"), "rename not shown in the switcher");
});

// ---------- public changelog ----------
const publicVersions = (p) => p.locator(".cl-entry-head h2").allInnerTexts();
await step("public changelog shows only live published versions", async () => {
  await go(v1, "apps/qa-app/");
  ok((await text(v1, "h1")) === "QA App Renamed", "wrong title");
  const list = await publicVersions(v1);
  ok(list.join() === "1.0", `expected only 1.0, got ${list.join()}`);
  ok(await v1.getByRole("link", { name: "App Store ↗" }).count() === 1, "store link missing");
  ok(await v1.getByRole("link", { name: "Contact the developer" }).count() === 1, "contact link missing");
});
await step("draft and future releases are not public", async () => {
  await go(v1, "apps/qa-app/1.1/");
  await v1.getByText("Nothing here yet.").waitFor();
  await go(v1, "apps/qa-app/2.0/");
  await v1.getByText("Nothing here yet.").waitFor();
});
await step("search engines get full HTML; drafts, future and unknown pages are real 404s", async () => {
  const html = await (await fetch(`${BASE}/apps/qa-app`)).text(); // plain HTTP, no JavaScript
  ok(html.includes("<title>QA App Renamed — What&#x27;s new</title>") || html.includes("<title>QA App Renamed — What's new</title>"), "changelog title missing");
  ok(html.includes("First version"), "release notes not in the HTML");
  ok(!html.includes("Draft notes.") && !html.includes("Future notes."), "draft or future notes leaked into HTML");
  const rel = await (await fetch(`${BASE}/apps/qa-app/1.0`)).text();
  ok(rel.includes('rel="canonical" href="http://localhost:3000/apps/qa-app/1.0"') || rel.includes("/apps/qa-app/1.0\""), "release canonical missing");
  for (const path of ["apps/qa-app/1.1", "apps/qa-app/2.0", "apps/no-such-app-xyz"]) {
    const r = await fetch(`${BASE}/${path}`);
    ok(r.status === 404, `${path} answered ${r.status}`);
  }
  const map = await (await fetch(`${BASE}/sitemap.xml`)).text();
  ok(map.includes("/apps/qa-app/1.0<") && !map.includes("/apps/qa-app/1.1<") && !map.includes("/apps/qa-app/2.0<"), "sitemap includes wrong versions");
  ok((await (await fetch(`${BASE}/robots.txt`)).text()).includes("sitemap.xml"), "robots.txt has no sitemap");
  ok((await (await fetch(`${BASE}/`)).text()).includes('name="robots" content="noindex'), "dashboard is indexable");
});
await step("full description toggle (multi-paragraph description)", async () => {
  await go(v1, "apps/tidepool");
  await v1.getByRole("button", { name: "Full description" }).click();
  await v1.getByRole("button", { name: "Show less" }).waitFor();
});
await step("publishing a draft makes it public", async () => {
  await go(dev, "#app/qa-app/1.1");
  await dev.getByRole("button", { name: "Publish", exact: true }).click();
  await toast(dev, "Published");
  await go(v1, "apps/qa-app/");
  const list = await publicVersions(v1);
  ok(list.join() === "1.1,1.0", `got ${list.join()}`);
});
await step("editing notes shows on the public page", async () => {
  await go(dev, "#app/qa-app/1.0");
  await dev.locator(".editor-form .notes-input").fill("First version, edited.");
  await dev.getByRole("button", { name: "Save", exact: true }).click();
  await toast(dev, "Saved");
  await go(v1, "apps/qa-app/1.0/");
  ok((await text(v1, ".cl-single .cl-notes")) === "First version, edited.", "notes not updated");
});
await step("What's new preview opens and closes", async () => {
  await go(dev, "#app/qa-app/1.0");
  await dev.getByRole("button", { name: "Preview What's new" }).click();
  await dev.locator(".app-sheet").getByRole("heading", { name: "New in 1.0" }).waitFor();
  await dev.keyboard.press("Escape");
  await dev.locator(".app-sheet").waitFor({ state: "detached" });
});

// ---------- visitors ----------
const love = (p) => p.locator(".cl-react button").first();
await step("visitor reacts and takes it back", async () => {
  await love(v1).click();
  await love(v1).filter({ hasText: /Love it\s*1$/ }).waitFor();
  ok((await love(v1).getAttribute("aria-pressed")) === "true", "reaction not marked");
  await love(v1).click();
  await love(v1).filter({ hasText: /Love it\s*0$/ }).waitFor();
  await love(v1).click();
  await love(v1).filter({ hasText: /Love it\s*1$/ }).waitFor();
});
await step("visitor comments", async () => {
  await v1.getByLabel("Comment").first().fill("Visitor one says hi");
  await v1.getByRole("button", { name: "Post" }).click();
  await v1.locator(".cl-msg-text", { hasText: "Visitor one says hi" }).waitFor();
  ok((await text(v1, ".community-count")) === "1", "count not 1");
  ok((await text(v1, ".cl-msg-head strong")).includes("(you)"), "own comment not marked");
});
await step("second visitor sees it, votes and replies", async () => {
  await go(v2, "apps/qa-app/1.0/");
  const t = v2.locator(".cl-msg").first();
  await t.getByRole("button", { name: /^Like/ }).first().click();
  await t.getByRole("button", { name: /^Like/ }).first().filter({ hasText: "♥ 1" }).waitFor();
  await t.getByRole("button", { name: "Reply" }).first().click();
  await v2.getByPlaceholder(/^Reply to/).fill("Visitor two replies");
  await t.locator(".cl-compose").getByRole("button", { name: "Post" }).click();
  await v2.locator(".cl-msg-text", { hasText: "Visitor two replies" }).waitFor();
});
await step("visitor 2 reports visitor 1; it disappears only for visitor 2", async () => {
  await go(v2, "apps/qa-app/1.0/");
  const first = v2.locator(".cl-msg", { hasText: "Visitor one says hi" }).first();
  await first.getByRole("button", { name: "Report" }).first().click();
  await first.getByLabel("Reason").selectOption("spam");
  await first.getByRole("button", { name: "Send" }).click();
  await v2.locator(".cl-msg-text", { hasText: "Visitor one says hi" }).waitFor({ state: "detached" });
  await go(v1, "apps/qa-app/1.0/");
  await v1.locator(".cl-msg-text", { hasText: "Visitor one says hi" }).waitFor();
});

// ---------- moderation ----------
await step("report shows in the inbox and can be dismissed", async () => {
  await go(dev, "#reports");
  const item = dev.locator(".mod-item", { hasText: "Visitor one says hi" }).first();
  await item.getByText("1 report: spam").waitFor();
  await item.getByRole("button", { name: "Dismiss reports" }).click();
  await toast(dev, "Reports dismissed");
  await dev.getByText("Nothing reported. All quiet.").waitFor();
});
await step("developer replies from the inbox", async () => {
  await go(dev, "#inbox");
  const item = dev.locator(".mod-item", { hasText: "Visitor one says hi" }).first();
  await item.getByRole("button", { name: "Reply as developer" }).click();
  await dev.getByPlaceholder(/^Reply to/).fill("Thanks from the developer");
  await dev.getByRole("button", { name: "Post reply" }).click();
  await toast(dev, "Reply posted");
  await go(v1, "apps/qa-app/1.0/");
  await v1.locator(".cl-msg.is-dev", { hasText: "Thanks from the developer" }).locator(".badge-dev").first().waitFor();
});
await step("the version's feedback column shows only that app", async () => {
  await go(dev, "#app/qa-app/1.0");
  await dev.locator(".feed .mod-item", { hasText: "Visitor one says hi" }).first().waitFor();
  ok(await dev.locator(".feed .tag", { hasText: "Tidepool" }).count() === 0, "another app's feedback in this app's column");
});
await step("developer comments on the public page as Developer", async () => {
  await go(dev, "apps/qa-app/1.0/");
  ok((await text(dev, ".cl-compose strong")) === "you (Developer)", "not posting as developer");
  await dev.getByLabel("Comment").last().fill("Developer note on the page");
  await dev.locator(".cl-discussion > .cl-compose").getByRole("button", { name: "Post" }).click();
  await dev.locator(".cl-msg.is-dev", { hasText: "Developer note on the page" }).first().waitFor();
});
await step("hiding a comment replaces it for visitors", async () => {
  await go(dev, "#inbox");
  const item = dev.locator(".mod-item", { hasText: "Visitor one says hi" }).first();
  await item.getByRole("button", { name: "Hide" }).first().click();
  await toast(dev, "Comment hidden");
  await go(v2, "apps/qa-app/1.0/");
  await v2.getByText("This comment has been hidden because it violated the community guidelines.").first().waitFor();
  await go(dev, "#inbox");
  await dev.locator(".mod-item", { hasText: "Visitor one says hi" }).first().getByRole("button", { name: "Unhide" }).click();
  await toast(dev, "Comment visible again");
});

// ---------- live dashboard ----------
await step("new comments and reports show up live, without reloading", async () => {
  await go(dev, "#inbox");
  await dev.reload();
  await dev.locator(".mod-item").first().waitFor();
  await dev.waitForTimeout(1500); // let the Realtime subscription join
  const badge = dev.locator(".topbar .top-link", { hasText: "Inbox" }).locator(".count-badge");
  const before = (await badge.count()) ? Number(await badge.innerText()) : 0;
  await go(v1, "apps/qa-app/1.0/");
  await v1.getByLabel("Comment").first().fill("Live comment " + Date.now());
  await v1.locator(".cl-discussion > .cl-compose").getByRole("button", { name: "Post" }).click();
  await dev.locator(".mod-item", { hasText: "Live comment" }).first().waitFor();
  await go(v2, "apps/qa-app/1.0/");
  const c = v2.locator(".cl-msg", { hasText: "Live comment" }).first();
  await c.getByRole("button", { name: "Report" }).click();
  await c.getByRole("button", { name: "Send" }).click();
  await badge.filter({ hasText: String(before + 1) }).waitFor();
});

// ---------- app proofs ----------
await step("requiring app proofs makes the web and the pretend phone read-only", async () => {
  await go(dev, "#settings/qa-app");
  const p = panel(dev, "App proofs");
  await p.getByLabel("Require app proofs").check();
  await p.getByRole("button", { name: "Save" }).click();
  await p.getByRole("alert").filter({ hasText: "Add an iOS App ID or an Android package first." }).waitFor();
  await p.getByLabel("iOS App ID").fill("ABCDE12345.com.example.qa");
  await p.getByRole("button", { name: "Save" }).click();
  await toast(dev, "App proofs required");
  await go(v1, "apps/qa-app/1.0");
  await v1.getByText("happen inside the app").waitFor();
  ok(await love(v1).isDisabled(), "web reaction still enabled");
  ok(await v1.getByLabel("Comment").count() === 0, "web comment form still shown");
  const blocked = await v1.evaluate(async () => (await fetch("/api/v1/sdk/votes", { method: "POST" })).status);
  ok(blocked === 401 || blocked === 400, `unsigned write answered ${blocked}`);
  await go(dev, "#preview/qa-app");
  await dev.getByText("the pretend phone can read but not vote or comment").waitFor();
  await go(dev, "#settings/qa-app");
  await panel(dev, "App proofs").getByLabel("Require app proofs").uncheck();
  await panel(dev, "App proofs").getByRole("button", { name: "Save" }).click();
  await toast(dev, "App proofs saved");
  await go(v1, "apps/qa-app/1.0");
  await v1.getByLabel("Comment").first().waitFor();
});

// ---------- SDK screen ----------
let oldKey;
await step("Install shows the key, both platforms, and copies code", async () => {
  await go(dev, "#sdk/qa-app");
  oldKey = (await text(dev, ".key")).trim();
  ok(/^clk_[a-z0-9]{16}$/.test(oldKey), `bad key ${oldKey}`);
  // Swift is the default tab; both snippets carry this app's key and this server's address.
  await dev.getByText("Add Package Dependencies").waitFor();
  const swiftCode = await dev.locator(".docs-code code").nth(0).innerText();
  ok(swiftCode.includes(oldKey) && swiftCode.includes(`URL(string: "${BASE}")`), "Swift snippet lacks key or server address");
  await dev.getByRole("button", { name: "React Native" }).click();
  await dev.getByText("npm install changelark-react-native").waitFor();
  const rnCode = await dev.locator(".docs-code code").nth(1).innerText();
  ok(rnCode.includes(oldKey) && rnCode.includes(`baseUrl="${BASE}"`), "RN snippet lacks key or server address");
  await dev.locator(".docs-code button").first().click();
  await dev.locator(".docs-code button", { hasText: "Copied" }).waitFor();
});
await step("React Native package downloads", async () => {
  const href = await dev.getByRole("link", { name: "Download the package" }).getAttribute("href");
  const r = await dev.request.get(BASE + href);
  ok(r.status() === 200 && (await r.body()).length > 1000, `download failed ${r.status()}`);
});
await step("making a new key turns the old one off", async () => {
  await dev.getByRole("button", { name: "Make a new key" }).click();
  await dev.locator(".key").filter({ hasNotText: oldKey }).waitFor();
  const r = await dev.request.get(`${BASE}/api/v1/sdk/config`, { headers: { "X-Changelark-App-Key": oldKey, "X-Changelark-Anon-Id": "x".repeat(24) } });
  ok(r.status() === 401, `old key still works (${r.status()})`);
});

// ---------- phone simulator ----------
// The newest log line, once it matches (launches that ask the server answer a moment later).
const phoneSays = (p, re) => p.locator(".phone-log li").first().filter({ hasText: re }).waitFor();
const openApp = async (version) => { await dev.getByLabel("Installed version").fill(version); await dev.getByRole("button", { name: "Launch the app" }).click(); };
await step("phone: fresh install is quiet, update shows the half sheet", async () => {
  await go(dev, "#preview/qa-app");
  await dev.getByRole("button", { name: "Reset phone" }).click();
  await openApp("1.0");
  await phoneSays(dev, /^First launch/);
  await openApp("1.1");
  await dev.locator(".phone-sheet").getByRole("heading", { name: "New in 1.1" }).waitFor();
  await openApp("1.1");
  await phoneSays(dev, /^Already seen/);
  await openApp("0.9");
  await phoneSays(dev, /^Older/);
  await openApp("2.0");
  await phoneSays(dev, /future release date/);
  await openApp("3.0");
  await phoneSays(dev, /^No published notes/);
});
const phoneMsg = (t) => dev.locator(".phone .as-msg", { hasText: t });
await step("phone: guidelines, chat message, reply, delete own", async () => {
  await openApp("1.0");
  await dev.locator(".phone .phone-primary", { hasText: "What's new" }).click();
  await dev.locator(".phone .as-feedback").click();
  await dev.getByRole("button", { name: "Accept and continue" }).click();
  await dev.getByLabel("Add a comment").fill("From the phone");
  await dev.locator(".phone-compose").getByRole("button", { name: "Send" }).click();
  const mine = phoneMsg("From the phone").first();
  await mine.waitFor();
  ok((await mine.locator(".as-who").innerText()).startsWith("You"), "own message not marked as You");
  await mine.getByRole("button", { name: "Reply" }).click();
  await dev.getByLabel("Add a comment").fill("Phone reply");
  await dev.locator(".phone-compose").getByRole("button", { name: "Send" }).click();
  await dev.locator(".phone .as-replies .as-msg", { hasText: "Phone reply" }).waitFor(); // indented under the comment it answers
  await mine.getByRole("button", { name: "More" }).click();
  await dev.getByRole("button", { name: "Delete comment" }).click();
  await dev.locator(".phone").getByText("Deleted by its author.").first().waitFor();
});
await step("phone: react, report and block", async () => {
  await dev.locator(".phone-chat").getByRole("button", { name: /^‹/ }).click();
  const loveBtn = dev.locator(".phone .as-react button").first();
  const was = await loveBtn.getAttribute("aria-pressed");
  await loveBtn.click();
  await dev.locator(".phone .as-react button").first().and(dev.locator(`[aria-pressed="${was === "true" ? "false" : "true"}"]`)).waitFor();
  await dev.locator(".phone .as-feedback").click();
  const other = phoneMsg("Visitor two replies").first();
  await other.getByRole("button", { name: "More" }).click();
  await dev.getByRole("button", { name: /^Block / }).click();
  await other.waitFor({ state: "detached" });
  const v1c = phoneMsg("Visitor one says hi").first();
  await v1c.getByRole("button", { name: "More" }).click();
  await dev.getByRole("button", { name: "Report", exact: true }).click();
  await phoneMsg("Visitor one says hi").first().waitFor({ state: "detached" });
});

// ---------- feedback loop ----------
await step("phone: a bug report lands in the inbox under Bugs, and can be marked fixed", async () => {
  await go(dev, "#preview/qa-app");
  await openApp("1.0");
  await dev.locator(".phone .phone-primary", { hasText: "What's new" }).click();
  await dev.locator(".phone").getByRole("button", { name: "Report a bug" }).click();
  await dev.getByLabel("Describe the bug").fill("Crashes when I rotate");
  await dev.locator(".phone").getByRole("button", { name: "Send report" }).click();
  await dev.locator(".phone").getByText("Thanks! The developer got your report.").waitFor();
  await go(dev, "#inbox/bugs");
  const item = dev.locator(".bug-item", { hasText: "Crashes when I rotate" }).first();
  await item.waitFor();
  await item.getByRole("button", { name: "Mark as fixed" }).click();
  await toast(dev, "Marked as fixed");
  await item.and(dev.locator(".is-resolved")).waitFor();
});
await step("translations: Italian notes show on the public page with ?lang=it", async () => {
  await go(dev, "#app/qa-app/1.0");
  await dev.getByLabel("Add a translation").selectOption("it");
  await dev.getByLabel("Notes in Italian").fill("Prima versione, in italiano.");
  await dev.getByRole("button", { name: "Save", exact: true }).click();
  await toast(dev, "Saved");
  await go(v1, "apps/qa-app/1.0?lang=it");
  ok((await text(v1, ".cl-single .cl-notes")) === "Prima versione, in italiano.", "Italian notes not shown");
  await v1.locator(".cl-langs a", { hasText: "IT" }).and(v1.locator("[aria-current=page]")).waitFor();
});
await step("notifications: a webhook address is saved, a bad one is refused", async () => {
  await go(dev, "#settings/qa-app");
  const p = panel(dev, "Notifications");
  await p.getByLabel("Webhook address").fill("ftp://example.com/hook");
  await p.getByRole("button", { name: "Save" }).click();
  await p.getByRole("alert").filter({ hasText: "https://" }).waitFor();
  await p.getByLabel("Webhook address").fill("https://hooks.slack.com/services/T000/B000/XXXX");
  await p.getByRole("button", { name: "Save" }).click();
  await toast(dev, "Webhook saved");
  await p.getByRole("button", { name: "Send a test" }).waitFor();
});
await step("RSS feed link on the public page", async () => {
  await go(v1, "apps/qa-app");
  const href = await v1.getByRole("link", { name: "RSS feed" }).getAttribute("href");
  const r = await fetch(BASE + href);
  ok(r.status === 200 && (await r.text()).includes("<rss"), "feed missing");
});

// ---------- cleanup flows ----------
await step("unpublish and delete a version", async () => {
  await go(dev, "#app/qa-app/1.1");
  await dev.getByRole("button", { name: "Unpublish" }).click();
  await toast(dev, "Moved to drafts");
  await dev.getByRole("button", { name: "Delete version" }).click();
  await dev.waitForURL(/#app\/qa-app$/);
  ok(!(await versions(dev)).includes("1.1"), "1.1 still listed");
});
await step("remove app removes its public page", async () => {
  await go(dev, "#settings/qa-app");
  await dev.getByRole("button", { name: "Remove app" }).click();
  await dev.locator(".version-item").first().waitFor();
  ok(!(await appOptions(dev)).includes("QA App Renamed"), "app still listed");
  await go(v1, "apps/qa-app/");
  await v1.getByText("Nothing here yet.").waitFor();
});
await step("log out goes to the login page", async () => {
  await go(dev, "");
  await menu(dev, "Log out");
  await dev.waitForURL(/\/login$/);
});

// ---------- accounts ----------
const acct = await ctx("account");
const email = `qa-${Date.now()}@example.com`;
await step("wrong password is refused", async () => {
  await acct.goto(`${BASE}/login/`);
  await acct.getByLabel("Email").fill("demo@changelark.example.invalid");
  await acct.getByLabel("Password").fill("nope-nope");
  await acct.getByRole("button", { name: /Log in/ }).click();
  await acct.getByRole("alert").filter({ hasText: "Wrong email or password." }).waitFor({ timeout: T });
});
// Supabase either says so or answers like a new signup, depending on the project's settings; both are fine.
await step("signup with a taken email is refused or answered neutrally", async () => {
  await acct.goto(`${BASE}/signup/`);
  await acct.getByLabel("Name").fill("Dup");
  await acct.getByLabel("Email").fill("demo@changelark.example");
  await acct.getByLabel("Password").fill("long-enough-1");
  await acct.getByRole("button", { name: /Create account/ }).click();
  await acct.getByRole("status").filter({ hasText: "open the link we emailed you" }).or(acct.getByRole("alert").filter({ hasText: "already exists" })).waitFor({ timeout: T });
});
await step("signup asks to confirm; can't sign in before confirming", async () => {
  await acct.getByLabel("Name").fill("QA Person");
  await acct.getByLabel("Email").fill(email);
  await acct.getByRole("button", { name: /Create account/ }).click();
  await acct.getByRole("status").filter({ hasText: "open the link we emailed you" }).waitFor({ timeout: T });
  await acct.goto(`${BASE}/login`);
  await acct.getByLabel("Email").fill(email);
  await acct.getByLabel("Password").fill("long-enough-1");
  await acct.getByRole("button", { name: /Log in/ }).click();
  await acct.getByRole("alert").filter({ hasText: "Confirm your email first" }).waitFor({ timeout: T });
});
await step("confirmation link (opened in another browser) signs in to an empty workspace", async () => {
  const other = await ctx("other-browser");
  await other.goto(await emailLink(email, "email"));
  await other.getByText("Add your first app").waitFor({ timeout: T });
  ok((await text(other, ".side-user")) === "QA Person", "wrong name");
  await other.context().close();
  await acct.goto(`${BASE}/login`);
  await acct.getByLabel("Email").fill(email);
  await acct.getByLabel("Password").fill("long-enough-1");
  await acct.getByRole("button", { name: /Log in/ }).click();
  await acct.getByText("Add your first app").waitFor({ timeout: T });
  ok((await text(acct, ".side-user")) === "QA Person", "wrong name");
  ok(await acct.getByText("Reset demo").count() === 0, "non-demo user sees Reset demo");
});
await step("log out and back in", async () => {
  await menu(acct, "Log out");
  await acct.waitForURL(/\/login$/, { timeout: T });
  await acct.getByLabel("Email").fill(email);
  await acct.getByLabel("Password").fill("long-enough-1");
  await acct.getByRole("button", { name: /Log in/ }).click();
  await acct.getByText("Add your first app").waitFor({ timeout: T });
});
await step("App Store Connect: a wrong key is refused before it's stored", async () => {
  await go(acct, "#account");
  await acct.getByLabel("Issuer ID").fill("00000000-0000-0000-0000-000000000000");
  await acct.getByLabel("Key ID").fill(asc.key.keyId);
  await acct.getByLabel("Or paste it").fill(asc.key.privateKey);
  await acct.getByRole("button", { name: "Connect", exact: true }).click();
  await acct.getByRole("alert").filter({ hasText: "Apple refused the key" }).waitFor({ timeout: T });
});
let vaultBefore;
let plannerSlug;
await step("App Store Connect: connect with a valid key (stored in Vault)", async () => {
  vaultBefore = vaultKeys();
  await acct.getByLabel("Issuer ID").fill(asc.key.issuerId);
  await acct.getByRole("button", { name: "Connect", exact: true }).click();
  await toast(acct, "App Store Connect connected");
  await acct.getByText(`Connected with key ${asc.key.keyId}`).waitFor({ timeout: T });
  ok(vaultKeys() === vaultBefore + 1, "key not in Vault");
});
await step("App Store Connect: link an app and import its versions", async () => {
  await go(acct, "#connect");
  await acct.getByLabel("App name").fill("Planner " + Date.now());
  await acct.getByRole("button", { name: "Add app" }).click();
  await acct.waitForURL(/#app\//, { timeout: T });
  const slug = acct.url().split("#app/")[1];
  plannerSlug = slug;
  await go(acct, `#settings/${slug}`);
  await acct.getByRole("button", { name: "Choose an App Store app" }).click();
  await acct.getByLabel("App Store app").selectOption("1460000001");
  await acct.getByRole("button", { name: "Link and import" }).click();
  await toast(acct, "Imported 5 versions");
  await go(acct, `#app/${slug}`);
  await acct.locator(".version-item").first().waitFor({ timeout: T });
  const rows = await acct.locator(".version-item").allInnerTexts();
  const row = (v) => rows.find((r) => r.split("\n")[0].trim() === v || r.includes(`${v}\n`)) || "";
  ok(!/draft/i.test(row("2.1")) && !/draft/i.test(row("2.0")) && row("2.1"), "live versions not published");
  ok(/draft/i.test(row("2.2")), "version in review should be a draft");
  ok(!row("1.9"), "rejected version was imported");
  ok(/draft/i.test(row("1.0")), "a live version with no text in any language should be a draft");
  ok(!/draft/i.test(row("1.5")), "1.5 has Italian text, so it should be published");
  ok(/app store/i.test(row("2.1")), "missing App Store tag");
  const html = await (await fetch(`${BASE}/apps/${slug}/2.1`)).text();
  ok(html.includes("Faster sync on large lists."), "English notes not used");
  ok((await (await fetch(`${BASE}/apps/${slug}/1.5`)).text()).includes("Ricerca più veloce."), "empty English entry hid the Italian notes");
});
await step("App Store Connect: linking an app the key can't see is refused", async () => {
  const appId = await acct.locator("[data-app-id]").getAttribute("data-app-id");
  const link = (body) => acct.evaluate(async (b) => (await fetch("/api/asc/link", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) })).status, body);
  ok((await link({ appId, ascAppId: "999" })) === 403, "linked an App Store app the key can't see");
  ok((await link({ appId: "00000000-0000-0000-0000-000000000000", ascAppId: "1460000001" })) === 404, "linked someone else's Changelark app");
});
await step("App Store Connect: the scheduled import publishes versions that went live", async () => {
  ok((await fetch(`${BASE}/api/cron/asc-sync`)).status === 401, "cron ran without the secret");
  const v22 = asc.versions["1460000001"].find((v) => v.id === "v22");
  v22.appVersionState = "READY_FOR_DISTRIBUTION";
  asc.versions["1460000001"].push({ id: "v23", versionString: "2.3", appVersionState: "PREPARE_FOR_SUBMISSION", createdDate: "2026-11-01T10:00:00Z", whatsNew: { "en-US": "Coming soon." } });
  const r = await fetch(`${BASE}/api/cron/asc-sync`, { headers: { Authorization: `Bearer ${CRON_SECRET}` } });
  const body = await r.json();
  ok(r.status === 200 && body.published >= 1 && body.imported >= 1, `cron result ${r.status} ${JSON.stringify(body)}`);
  await go(acct, `#app/${plannerSlug}`);
  await acct.reload();
  await acct.locator(".version-item").first().waitFor({ timeout: T });
  const item = (v) => acct.locator(".version-item", { has: acct.locator(".v", { hasText: new RegExp(`^${v.replace(".", "\\.")}$`) }) }).innerText();
  ok(!/draft/i.test(await item("2.2")), "2.2 not published after going live");
  ok(/draft/i.test(await item("2.3")), "2.3 not imported as draft");
});
await step("App Store Connect: disconnect deletes the stored key", async () => {
  await go(acct, "#account");
  await acct.getByRole("button", { name: "Disconnect" }).click();
  await toast(acct, "Disconnected");
  ok(vaultKeys() === vaultBefore, "key still in Vault after disconnect");
});
// A visitor comments on the developer's imported app through the SDK API.
async function visitorComment(text) {
  const { key } = await (await fetch(`${BASE}/api/v1/public/${plannerSlug}`)).json();
  const headers = { "Content-Type": "application/json", "X-Changelark-App-Key": key, "X-Changelark-Anon-Id": "mailcheck" + Date.now() + Math.random().toString(36).slice(2, 8) };
  await fetch(`${BASE}/api/v1/sdk/guidelines/accept`, { method: "POST", headers, body: "{}" });
  const r = await fetch(`${BASE}/api/v1/sdk/releases/2.1/comments`, { method: "POST", headers, body: JSON.stringify({ body: text }) });
  ok(r.status === 201, `visitor comment failed ${r.status}`);
}
const runDigest = async () => (await fetch(`${BASE}/api/cron/alerts`, { headers: { Authorization: `Bearer ${CRON_SECRET}` } })).json();

await step("email alerts: a digest of new comments, with commenter text escaped", async () => {
  ok((await fetch(`${BASE}/api/cron/alerts`)).status === 401, "digest ran without the secret");
  await visitorComment("Love it <b>so much</b> & more");
  const before = (await messagesTo(email)).length;
  const result = await runDigest();
  ok(result.sent >= 1, `digest sent nothing: ${JSON.stringify(result)}`);
  const msgs = await messagesTo(email);
  ok(msgs.length === before + 1, "no digest email arrived");
  ok(/1 new comment/.test(msgs[0].Subject), `subject: ${msgs[0].Subject}`);
  const html = await messageHtml(msgs[0].ID);
  ok(html.includes("&lt;b&gt;so much&lt;/b&gt; &amp; more") && !html.includes("<b>so much</b>"), "comment text not escaped in email");
  ok((await runDigest()).sent === 0 || (await messagesTo(email)).length === before + 1, "digest repeated old comments");
});
await step("email alerts: turned off means no email", async () => {
  await go(acct, "#account");
  await acct.getByLabel("Email me a summary of new comments and reports").uncheck();
  await toast(acct, "Email alerts off");
  await visitorComment("Another one while alerts are off");
  const before = (await messagesTo(email)).length;
  await runDigest();
  ok((await messagesTo(email)).length === before, "email sent with alerts off");
});
// A second copy of the local build (output: "standalone") on 127.0.0.1:3100 with SMTP_URL emptied
// (an empty env var also beats .env files). The account's cookies are copied over to it.
await step("email alerts: hidden when the app has no SMTP_URL", async () => {
  const NOMAIL = "http://127.0.0.1:3100", dir = ".next/standalone";
  ok(existsSync(`${dir}/server.js`), `${dir}/server.js missing: run npm run build first`);
  cpSync(".next/static", `${dir}/.next/static`, { recursive: true }); // standalone leaves these to you
  cpSync("public", `${dir}/public`, { recursive: true });
  const server = spawn("node", [`${dir}/server.js`], { env: { ...process.env, SMTP_URL: "", PORT: "3100", HOSTNAME: "127.0.0.1" }, stdio: "ignore", detached: true });
  try {
    let up = false;
    for (let i = 0; i < 60 && !up; i++) up = await fetch(NOMAIL).then(() => true, () => new Promise((r) => setTimeout(r, 500, false)));
    ok(up, `the build did not start on ${NOMAIL} within 30 s`);
    const cookies = await acct.context().cookies(BASE);
    await acct.context().addCookies(cookies.map(({ name, value }) => ({ name, value, url: NOMAIL })));
    await acct.goto(`${NOMAIL}/#account`);
    await panel(acct, "Profile").waitFor({ timeout: T });
    ok((await panel(acct, "Email alerts").count()) === 0, "email alerts offered without SMTP");
    await go(acct, "#account");
    await panel(acct, "Email alerts").waitFor({ timeout: T });
  } finally { process.kill(-server.pid); }
});
await step("profile: rename, and password change needs the current password", async () => {
  await go(acct, "#account");
  const p = panel(acct, "Profile");
  await p.getByLabel("Name").fill("QA Renamed");
  await p.getByRole("button", { name: "Save name" }).click();
  await toast(acct, "Name saved");
  await acct.locator(".side-user").filter({ hasText: "QA Renamed" }).waitFor({ timeout: T });
  await p.getByLabel("Current password").fill("wrong-password");
  await p.getByLabel("New password").fill("profile-pass-3");
  await p.getByRole("button", { name: "Change password" }).click();
  await p.getByRole("alert").filter({ hasText: "current password isn't right" }).waitFor({ timeout: T });
  await p.getByLabel("Current password").fill("long-enough-1");
  await p.getByRole("button", { name: "Change password" }).click();
  await toast(acct, "Password changed");
  await p.getByLabel("Name").fill("QA Person");
  await p.getByRole("button", { name: "Save name" }).click();
  await toast(acct, "Name saved");
});
await step("forgot password: email link, new password, sign in with it", async () => {
  await menu(acct, "Log out");
  await acct.waitForURL(/\/login$/, { timeout: T });
  await acct.getByRole("link", { name: "Forgot your password?" }).click();
  await acct.getByLabel("Email").fill(email);
  await acct.getByRole("button", { name: /Email me a link/ }).click();
  await acct.getByRole("status").filter({ hasText: "on its way" }).waitFor({ timeout: T });
  await acct.goto(await emailLink(email, "recovery"));
  await acct.waitForURL(/\/reset-password$/, { timeout: T });
  await acct.getByLabel("New password").fill("brand-new-pass-2");
  await acct.getByRole("button", { name: /Save password/ }).click();
  await acct.locator(".side-user").filter({ hasText: "QA Person" }).waitFor({ timeout: T });
  await menu(acct, "Log out");
  await acct.waitForURL(/\/login$/, { timeout: T });
  await acct.getByLabel("Email").fill(email);
  await acct.getByLabel("Password").fill("brand-new-pass-2");
  await acct.getByRole("button", { name: /Log in/ }).click();
  await acct.locator(".side-user").filter({ hasText: "QA Person" }).waitFor({ timeout: T });
});
await step("forgot password for an unknown email looks the same", async () => {
  const p = await ctx("stranger");
  await p.goto(`${BASE}/forgot-password`);
  await p.getByLabel("Email").fill(`nobody-${Date.now()}@example.com`);
  await p.getByRole("button", { name: /Email me a link/ }).click();
  await p.getByRole("status").filter({ hasText: "on its way" }).waitFor({ timeout: T });
  await p.context().close();
});
await step("a bad or used email link explains itself", async () => {
  const p = await ctx("stranger");
  await p.goto(`${BASE}/auth/confirm?token_hash=nope&type=recovery&next=/reset-password`);
  await p.waitForURL(/\/login\?error=link$/, { timeout: T });
  await p.getByRole("alert").filter({ hasText: "invalid or has expired" }).waitFor({ timeout: T });
  await p.goto(`${BASE}/auth/confirm?token_hash=nope&type=email&next=//evil.example.com`);
  ok(new URL(p.url()).host === new URL(BASE).host, "redirected off-site");
  await p.context().close();
});
await step("delete account removes the account and its apps", async () => {
  await go(acct, "#connect");
  await acct.getByLabel("App name").fill("Doomed " + Date.now());
  await acct.getByRole("button", { name: "Add app" }).click();
  await acct.waitForURL(/#app\//, { timeout: T });
  const slug = acct.url().split("#app/")[1];
  ok((await fetch(`${BASE}/apps/${slug}`)).status === 200, "new app page missing");
  await go(acct, "#account");
  const del = acct.getByRole("button", { name: "Delete my account" });
  ok(await del.isDisabled(), "delete enabled before confirming");
  await acct.getByLabel(/to confirm/).fill(email);
  await del.click();
  await acct.waitForURL(/\/login\?deleted=1$/, { timeout: T });
  await acct.getByRole("status").filter({ hasText: "were deleted" }).waitFor({ timeout: T });
  ok((await fetch(`${BASE}/apps/${slug}`)).status === 404, "app page survived account deletion");
  await acct.getByLabel("Email").fill(email);
  await acct.getByLabel("Password").fill("brand-new-pass-2");
  await acct.getByRole("button", { name: /Log in/ }).click();
  await acct.getByRole("alert").filter({ hasText: "Wrong email or password." }).waitFor({ timeout: T });
});
await step("the demo account can't be deleted", async () => {
  const p = await ctx("demo-account");
  await p.goto(`${BASE}/#account`);
  await p.getByText("The shared demo account can't be deleted.").waitFor({ timeout: T });
  const r = await p.request.delete(`${BASE}/api/account`, { data: { confirm: "demo@changelark.example" } });
  ok(r.status() === 403, `demo delete answered ${r.status()}`);
  await p.context().close();
});
await step("'try the demo' from the login page", async () => {
  await acct.goto(`${BASE}/login`);
  await acct.getByRole("link", { name: "try the demo" }).click();
  await acct.locator(".version-item").first().waitFor({ timeout: T });
  ok((await appOptions(acct)).length === 4, "demo apps missing");
});
await step("theme switch", async () => {
  await acct.goto(`${BASE}/login/`);
  await acct.getByRole("button", { name: "Dark" }).click();
  ok(await acct.evaluate(() => document.documentElement.dataset.theme) === "dark", "theme not dark");
  await acct.getByRole("button", { name: "System" }).click();
});

// ---------- other pages ----------
await step("docs pages load", async () => {
  for (const path of ["docs/", "docs/react-native/"]) {
    const r = await v1.goto(`${BASE}/${path}`);
    ok(r.status() === 200, `${path} ${r.status()}`);
    ok((await v1.locator("h1").count()) >= 1, `${path} has no heading`);
  }
});
await step("unknown page shows not found", async () => {
  await go(v1, "apps/no-such-app-xyz/");
  await v1.getByText("Nothing here yet.").waitFor({ timeout: T });
});
await step("internal links resolve", async () => {
  const seen = new Set();
  for (const path of ["docs/", "docs/react-native/", "login/", "signup/", "apps/tidepool/"]) {
    await go(v1, path);
    for (const href of await v1.locator("a[href^='/']").evaluateAll((as) => as.map((a) => a.getAttribute("href")))) seen.add(href.split("#")[0]);
  }
  const broken = [];
  for (const h of seen) { const r = await v1.request.get(BASE + h); if (r.status() >= 400) broken.push(`${h} ${r.status()}`); }
  ok(broken.length === 0, "broken: " + broken.join(", "));
});

await browser.close();
asc.close();
const failed = results.filter((r) => r[0] === "✗");
console.log(`\n${results.length - failed.length}/${results.length} steps passed.`);
const uniq = [...new Set(problems)];
console.log(`\n4xx responses (expected ones come from refused actions):`); [...new Set(expected4xx)].forEach((x) => console.log(" -", x));
if (uniq.length) { console.log(`\n${uniq.length} browser problems:`); uniq.slice(0, 30).forEach((p) => console.log(" -", p)); }
process.exit(failed.length || uniq.length ? 1 : 0);
