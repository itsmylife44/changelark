// The API the in-app packages (Swift, React Native) and the public changelog pages talk to.
// Auth: the public app key says which app; X-Changelark-Anon-Id is the device's install id (stored only as a hash).
// The key is public, so everything here is limited to published notes and anonymous community actions.
import { randomBytes, randomUUID } from "node:crypto";
import { after } from "next/server";
import { admin, tagOf, nameOf, json, fail, withinLimit, tooMany, LIMITS } from "../../../../../lib/server";
import { verifyAssertion, verifyAttestation, ProofError } from "../../../../../lib/attest";
import { verifyPlayToken, parseServiceAccount } from "../../../../../lib/play";
import type { Tables } from "../../../../../lib/database.types";
import decider from "../../../../../sdk/react-native/src/decider";
import type {
  ApiComment, ApiConfig, ApiNewReplies, ApiOk, ApiPage, ApiRelease, ApiVoteResult, ApiWhatsNew, ReportReason,
} from "../../../../../sdk/react-native/src/client";
import {
  type Ctx, must, today, RELEASE_COLS, publishedReleases, serializeReleases, findRelease, findComment, commentTree, pageParams, paged,
} from "../../../../../lib/sdk-data";
import { notifyWebhook, quote } from "../../../../../lib/feedback";

const COMMENTS_PER_MINUTE = 5;
const REASONS: ReportReason[] = ["spam", "abuse", "off-topic"];
const SCREENSHOT_MAX = 1.5 * 1024 * 1024;

// base64 PNG or JPEG (a data: URL is fine too) → bytes and type, or null if it isn't one.
function screenshot(raw: unknown): { bytes: Buffer; type: "image/png" | "image/jpeg"; ext: string } | null {
  if (typeof raw !== "string" || !raw) return null;
  const bytes = Buffer.from(raw.replace(/^data:image\/\w+;base64,/, ""), "base64");
  if (bytes.length > SCREENSHOT_MAX) throw fail(413, "screenshot_too_big", "The screenshot is over 1.5 MB. Send a smaller one.");
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { bytes, type: "image/png", ext: "png" };
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { bytes, type: "image/jpeg", ext: "jpg" };
  throw fail(400, "bad_screenshot", "The screenshot must be a PNG or JPEG.");
}

type ProofConfig = Pick<Tables<"apps">, "owner_id" | "proof_mode" | "ios_app_id" | "ios_attest_env" | "android_package">;

async function context(req: Request): Promise<Ctx & { cfg: ProofConfig }> {
  const key = req.headers.get("x-changelark-app-key") || "";
  const anon = req.headers.get("x-changelark-anon-id") || "";
  if (!key.startsWith("clk_")) throw fail(401, "bad_key", "Use the public app key (starts with clk_).");
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(anon)) throw fail(400, "bad_install", "Missing or invalid X-Changelark-Anon-Id.");
  const db = admin();
  const { data: row } = await db.from("apps").select("id, name, color, owner_id, proof_mode, ios_app_id, ios_attest_env, android_package").eq("key", key).maybeSingle();
  if (!row) throw fail(401, "unknown_key", "Unknown app key. It may have been replaced in the dashboard.");
  const { id, name, color, ...cfg } = row;
  const app = { id, name, color };
  const tag = tagOf(anon);
  const { data: inst } = await db.from("installs").select("guidelines_accepted_at, blocked_tags").eq("app_id", app.id).eq("device_tag", tag).maybeSingle();
  return { db, app, tag, cfg, inst: inst || { guidelines_accepted_at: null, blocked_tags: [] } };
}

// ---------- app proofs (Apple App Attest, Google Play Integrity) ----------
const CHALLENGE_TTL_MS = 5 * 60 * 1000;

// Single use, for this app and device, within five minutes.
async function useChallenge(ctx: Ctx, challenge: string | null) {
  if (!challenge) throw fail(401, "proof_required", "This app only accepts votes and comments from its official app.");
  const { data } = await ctx.db.from("attest_challenges").update({ used: true })
    .eq("challenge", challenge).eq("app_id", ctx.app.id).eq("device_tag", ctx.tag).eq("used", false).gt("expires_at", new Date().toISOString())
    .select("challenge");
  if (!data?.length) throw fail(401, "challenge_invalid", "The proof challenge expired or was already used. Try again.");
}

async function checkProof(req: Request, ctx: Ctx & { cfg: ProofConfig }) {
  const h = (n: string) => req.headers.get(n);
  const challenge = h("x-changelark-challenge");
  const proof = h("x-changelark-proof");
  const kind = h("x-changelark-proof-kind") || "apple";
  if (!proof) throw fail(401, "proof_required", "This app only accepts votes and comments from its official app.");
  await useChallenge(ctx, challenge);
  try {
    if (kind === "apple") {
      if (!ctx.cfg.ios_app_id) throw new ProofError("iOS proofs aren't set up for this app");
      const keyId = h("x-changelark-proof-key") || "";
      const { data: key } = await ctx.db.from("attest_keys").select("public_key, counter, device_tag").eq("app_id", ctx.app.id).eq("key_id", keyId).maybeSingle();
      if (!key || key.device_tag !== ctx.tag) throw fail(401, "attestation_required", "Register this device's App Attest key first.");
      const counter = verifyAssertion({ assertion: proof, challenge: challenge!, publicKey: key.public_key, appId: ctx.cfg.ios_app_id, counter: key.counter });
      // Only moves forward, so two requests racing with the same counter can't both pass.
      const { data: moved } = await ctx.db.from("attest_keys").update({ counter }).eq("app_id", ctx.app.id).eq("key_id", keyId).lt("counter", counter).select("key_id");
      if (!moved?.length) throw new ProofError("assertion was replayed");
    } else if (kind === "play") {
      if (!ctx.cfg.android_package) throw new ProofError("Android proofs aren't set up for this app");
      const { data: json } = await ctx.db.rpc("play_service_account", { p_owner: ctx.cfg.owner_id });
      if (!json) throw new ProofError("the developer hasn't connected Google Play Integrity");
      await verifyPlayToken({ token: proof, challenge: challenge!, packageName: ctx.cfg.android_package, account: parseServiceAccount(json) });
    } else throw new ProofError("unknown proof kind");
  } catch (e) {
    if (e instanceof ProofError) throw fail(401, "proof_invalid", `App proof rejected: ${e.message}.`);
    throw e;
  }
}

async function body(req: Request): Promise<Record<string, unknown>> {
  try { const b = await req.json(); return b && typeof b === "object" ? b : {}; } catch { return {}; }
}

type Params = { params: Promise<{ path: string[] }> };

async function handle(req: Request, { params }: Params): Promise<Response> {
  const { path } = await params;
  const route = `${req.method} /${path.join("/")}`;
  if (req.method !== "GET") {
    if (!(await withinLimit(req, "write"))) return tooMany(LIMITS.write.seconds);
    if (/^POST \/(releases\/[^/]+\/comments|bugs)$/.test(route) && !(await withinLimit(req, "comment"))) return tooMany(LIMITS.comment.seconds);
  }
  const ctx = await context(req);
  const { db, app, tag } = ctx;
  const isAttestRoute = route.startsWith("POST /attest/");
  if (req.method !== "GET" && !isAttestRoute && ctx.cfg.proof_mode === "required") await checkProof(req, ctx);
  const q = new URL(req.url).searchParams;
  const locale = req.headers.get("x-changelark-locale");
  let m: RegExpMatchArray | null;

  if (route === "GET /config") {
    return json<ApiConfig>({ app: { name: app.name, color: app.color, proofRequired: ctx.cfg.proof_mode === "required" }, me: { name: nameOf(tag), guidelinesAccepted: !!ctx.inst.guidelines_accepted_at } });
  }

  if (route === "POST /attest/challenge") {
    const challenge = randomBytes(32).toString("base64url"); // also a valid Play Integrity nonce
    must(await db.from("attest_challenges").insert({ challenge, app_id: app.id, device_tag: tag, expires_at: new Date(Date.now() + CHALLENGE_TTL_MS).toISOString() }));
    if (Math.random() < 0.05) await db.from("attest_challenges").delete().lt("expires_at", new Date().toISOString()); // ponytail: opportunistic cleanup
    return json({ challenge }, 201);
  }

  if (route === "POST /attest/register") {
    const { keyId, attestation, challenge } = await body(req);
    if (!ctx.cfg.ios_app_id) return fail(400, "ios_not_configured", "iOS App Attest isn't set up for this app.");
    if (typeof keyId !== "string" || typeof attestation !== "string" || typeof challenge !== "string" || attestation.length > 20000) return fail(400, "bad_attestation", "Send keyId, attestation and challenge.");
    await useChallenge(ctx, challenge);
    let publicKey: string;
    try {
      publicKey = verifyAttestation({ attestation, challenge, keyId, appId: ctx.cfg.ios_app_id, env: ctx.cfg.ios_attest_env as "production" | "development" });
    } catch (e) {
      if (e instanceof ProofError) return fail(401, "proof_invalid", `Attestation rejected: ${e.message}.`);
      throw e;
    }
    const { error } = await db.from("attest_keys").insert({ app_id: app.id, key_id: keyId, device_tag: tag, public_key: publicKey });
    if (error?.code === "23505") return fail(409, "key_exists", "This key is already registered.");
    if (error) throw fail(500, "db", error.message);
    return json<ApiOk>({ ok: true }, 201);
  }

  if (route === "GET /whats-new") {
    const version = q.get("version") || "";
    if (!/^\d+(\.\d+){0,3}$/.test(version)) return fail(400, "bad_version", "Pass ?version=1.2.3");
    const all = must(await db.from("releases").select(`${RELEASE_COLS}, published`).eq("app_id", app.id));
    const r = all.find((x) => decider.cmpVersion(x.version, version) === 0);
    if (!r) return json<ApiWhatsNew>({ state: "unknown_version", release: null });
    if (!r.published) return json<ApiWhatsNew>({ state: "notes_pending", release: null });
    if (r.release_date > today()) return json<ApiWhatsNew>({ state: "not_live_yet", release: null });
    const [release] = await serializeReleases(db, tag, [r], locale);
    return json<ApiWhatsNew>({ state: "available", release });
  }

  if (route === "GET /releases") {
    const page = pageParams(q);
    const rows = await publishedReleases(db, app.id, page);
    return json<ApiPage<ApiRelease>>(paged(await serializeReleases(db, tag, rows, locale), page));
  }

  if ((m = route.match(/^GET \/releases\/([^/]+)\/comments$/))) {
    const r = await findRelease(ctx, decodeURIComponent(m[1]));
    // ponytail: builds the whole tree, then pages the threads; fine until a release has thousands of comments.
    const page = pageParams(q);
    return json<ApiPage<ApiComment>>(paged((await commentTree(ctx, r.id)).slice(page.offset), page));
  }

  // Developer replies to this install's comments since the last check, so the app can reopen the chat.
  // Only database timestamps, so a clock gap between this server and Postgres can't skip a reply.
  if (route === "GET /new-replies") {
    const raw = q.get("since");
    const since = raw && !Number.isNaN(Date.parse(raw)) ? raw : null;
    const start = since ?? "1970-01-01T00:00:00Z";
    const mine = must(await db.from("comments").select("id, releases!inner(app_id)").eq("author_tag", tag).eq("releases.app_id", app.id));
    if (!mine.length) return json<ApiNewReplies>({ count: 0, version: null, checkedAt: start });
    // ponytail: one IN list of this install's comments; fine for the handful a person writes.
    const replies = must(await db.from("comments").select("created_at, releases!inner(version)")
      .in("parent_id", mine.map((c) => c.id)).eq("is_dev", true).eq("hidden", false).eq("deleted", false)
      .gt("created_at", start).order("created_at", { ascending: false }));
    const newest = replies[0];
    // First check: replies from before this package version count as already read.
    if (!since) return json<ApiNewReplies>({ count: 0, version: null, checkedAt: newest?.created_at ?? start });
    return json<ApiNewReplies>({ count: replies.length, version: newest?.releases.version ?? null, checkedAt: newest?.created_at ?? since });
  }

  if ((m = route.match(/^GET \/comments\/([^/]+)\/replies$/))) {
    const c = await findComment(ctx, m[1]);
    return json<ApiPage<ApiComment>>({ items: await commentTree(ctx, c.release_id, c.id), nextCursor: null });
  }

  if (route === "POST /votes") {
    const { targetType, targetId, value } = await body(req);
    if (value !== -1 && value !== 0 && value !== 1) return fail(400, "bad_vote", "value must be -1, 0 or 1.");
    if (typeof targetId !== "string") return fail(400, "bad_target", "targetId is required.");
    let column: "release_id" | "comment_id";
    if (targetType === "release") {
      column = "release_id";
      const r = must(await db.from("releases").select("id").eq("id", targetId).eq("app_id", app.id).eq("published", true).maybeSingle());
      if (!r) return fail(404, "release_not_found", "Release not found.");
    } else if (targetType === "comment") {
      column = "comment_id";
      const c = await findComment(ctx, targetId);
      if (c.hidden || c.deleted) return fail(409, "comment_removed", "This comment was removed.");
    } else return fail(400, "bad_target", "targetType must be release or comment.");
    if (value === 0) must(await db.from("votes").delete().eq("voter_tag", tag).eq(column, targetId));
    else must(await db.from("votes").upsert({ voter_tag: tag, value, release_id: column === "release_id" ? targetId : null, comment_id: column === "comment_id" ? targetId : null }, { onConflict: "voter_tag,release_id,comment_id" }));
    const t = must(await db.from(targetType === "release" ? "releases" : "comments").select("up_count, down_count").eq("id", targetId).single());
    return json<ApiVoteResult>({ upCount: t.up_count, downCount: t.down_count, myVote: value });
  }

  if (route === "POST /guidelines/accept") {
    must(await db.from("installs").upsert({ app_id: app.id, device_tag: tag, guidelines_accepted_at: new Date().toISOString() }, { onConflict: "app_id,device_tag" }));
    return json<ApiOk>({ ok: true });
  }

  if ((m = route.match(/^POST \/releases\/([^/]+)\/comments$/))) {
    if (!ctx.inst.guidelines_accepted_at) return fail(403, "guidelines_required", "Accept the community guidelines first.");
    const r = await findRelease(ctx, decodeURIComponent(m[1]));
    const { body: text, parentId = null } = await body(req);
    const clean = typeof text === "string" ? text.trim() : "";
    if (!clean || clean.length > 1000) return fail(400, "bad_body", "Write between 1 and 1000 characters.");
    if (parentId !== null) {
      const p = await findComment(ctx, parentId);
      if (p.release_id !== r.id || p.deleted || p.hidden) return fail(400, "bad_parent", "You can't reply to that comment.");
    }
    // ponytail: per-device limit only; add an IP limit (e.g. at the edge) if someone rotates install ids.
    const since = new Date(Date.now() - 60e3).toISOString();
    const { count } = await db.from("comments").select("id", { count: "exact", head: true }).eq("author_tag", tag).gte("created_at", since);
    if ((count ?? 0) >= COMMENTS_PER_MINUTE) return fail(429, "slow_down", "You're commenting too fast. Try again in a minute.");
    const c = must(await db.from("comments").insert({ release_id: r.id, parent_id: parentId as string | null, body: clean, author_name: nameOf(tag), author_tag: tag }).select("id").single());
    after(() => notifyWebhook(db, app.id, "comment", `💬 ${nameOf(tag)} on ${app.name} ${r.version}: ${quote(clean)}`));
    return json({ id: c.id }, 201);
  }

  if (route === "POST /reports") {
    const { targetId, reason = "abuse" } = await body(req);
    if (!REASONS.includes(reason as ReportReason)) return fail(400, "bad_reason", "reason must be spam, abuse or off-topic.");
    const c = await findComment(ctx, targetId);
    const added = must(await db.from("reports").upsert({ comment_id: c.id, reason: reason as ReportReason, reporter_tag: tag }, { onConflict: "comment_id,reporter_tag", ignoreDuplicates: true }).select("comment_id"));
    if (added.length) after(() => notifyWebhook(db, app.id, "report", `🚩 A comment on ${app.name} was reported (${reason}): ${quote(c.body)}`));
    return json<ApiOk>({ ok: true });
  }

  if ((m = route.match(/^DELETE \/comments\/([^/]+)$/))) {
    const c = await findComment(ctx, m[1]);
    if (c.author_tag !== tag) return fail(403, "not_yours", "You can only delete your own comments.");
    must(await db.from("comments").update({ deleted: true, body: "" }).eq("id", c.id));
    return json<ApiOk>({ ok: true });
  }

  if (route === "POST /blocks") {
    const { commentId } = await body(req);
    const c = await findComment(ctx, commentId);
    if (c.is_dev || !c.author_tag) return fail(400, "cant_block_developer", "The developer can't be blocked.");
    if (c.author_tag !== tag && !ctx.inst.blocked_tags.includes(c.author_tag)) {
      must(await db.from("installs").upsert({ app_id: app.id, device_tag: tag, blocked_tags: [...ctx.inst.blocked_tags, c.author_tag] }, { onConflict: "app_id,device_tag" }));
    }
    return json<ApiOk>({ ok: true });
  }

  if (route === "POST /bugs") {
    const { body: text, version, device = "", screenshot: shot } = await body(req);
    const clean = typeof text === "string" ? text.trim() : "";
    if (!clean || clean.length > 2000) return fail(400, "bad_body", "Describe the bug in 1 to 2000 characters.");
    if (typeof version !== "string" || !/^\d+(\.\d+){0,3}$/.test(version)) return fail(400, "bad_version", "Send the installed version, like 1.2.3.");
    const image = screenshot(shot);
    const id = randomUUID();
    let path: string | null = null;
    if (image) {
      path = `${app.id}/${id}.${image.ext}`;
      const { error } = await db.storage.from("screenshots").upload(path, image.bytes, { contentType: image.type });
      if (error) throw fail(500, "upload_failed", "The screenshot couldn't be saved.");
    }
    must(await db.from("bug_reports").insert({ id, app_id: app.id, version, body: clean, device: String(device).slice(0, 120), screenshot_path: path, reporter_tag: tag, reporter_name: nameOf(tag) }));
    after(() => notifyWebhook(db, app.id, "bug", `🐞 Bug report on ${app.name} ${version}${path ? " (with screenshot)" : ""}: ${quote(clean)}`));
    return json({ id }, 201);
  }

  return fail(404, "not_found", `No route for ${route}`);
}

async function safe(req: Request, ctx: Params) {
  try { return await handle(req, ctx); } catch (e) {
    if (e instanceof Response) return e;
    console.error(e);
    return fail(500, "server_error", "Something went wrong.");
  }
}

export { safe as GET, safe as POST, safe as DELETE };
