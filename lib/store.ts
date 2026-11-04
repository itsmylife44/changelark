"use client";
// The signed-in developer's workspace, loaded from Supabase (RLS limits it to their own apps).
// Components read it with useStore(); every change writes to the database, then reloads.
import { useEffect, useSyncExternalStore } from "react";
import type { PostgrestError, RealtimeChannel, User as AuthUser } from "@supabase/supabase-js";
import decider from "../sdk/react-native/src/decider";
import { createClient } from "../sdk/react-native/src/client";
import { supabase } from "./supabase";
import { DEMO } from "./demo-account";

export { DEMO };

// ---------- workspace shape ----------
export interface Report { reason: string }
export interface Comment {
  id: string;
  release_id: string;
  parent: string | null;
  text: string;
  date: string;
  author: string;
  dev: boolean;
  up: number;
  down: number;
  hidden: boolean;
  deleted: boolean;
  reports: Report[];
}
export interface Release {
  id: string;
  app_id: string;
  version: string;
  date: string;
  notes: string;
  published: boolean;
  up: number;
  down: number;
  comments: Comment[];
  source: "manual" | "app_store";
  /** Translated notes by language code, e.g. { it: "…" }. */
  translations: Record<string, string>;
}
export interface Bug { id: string; app_id: string; version: string; text: string; device: string; screenshot: string | null; author: string; resolved: boolean; date: string }
export interface App {
  id: string;
  slug: string;
  owner: string;
  name: string;
  color: string;
  description: string;
  storeUrl: string;
  contact: string;
  key: string;
  synced: string;
  ascAppId: string | null;
  proofMode: "off" | "required";
  iosAppId: string | null;
  iosAttestEnv: "production" | "development";
  androidPackage: string | null;
  webhookUrl: string | null;
  releases: Release[];
  bugs: Bug[];
}
export interface User { id: string; email: string; name: string }
export interface AscConnection { issuerId: string; keyId: string; lastSyncAt: string | null; lastError: string | null }
export interface AscApp { id: string; name: string; bundleId: string }
export interface State { ready: boolean; user: User | null; apps: App[]; asc: AscConnection | null; play: { clientEmail: string } | null; emailAlerts: boolean }
export interface AppFields { name: string; description: string; storeUrl: string; contact: string; color: string }

const EMPTY: State = { ready: false, user: null, apps: [], asc: null, play: null, emailAlerts: true };
let state = EMPTY;
const subs = new Set<() => void>();
function set(next: State) { state = next; subs.forEach((f) => f()); }
function subscribe(cb: () => void) { subs.add(cb); return () => { subs.delete(cb); }; }

let started = false;
function start() {
  if (started) return;
  started = true;
  // Don't await Supabase calls inside this callback; defer them.
  supabase().auth.onAuthStateChange((event, session) => {
    if (event === "TOKEN_REFRESHED") return;
    setTimeout(() => { refresh(session?.user || null); live(!!session); }, 0);
  });
  // New comments and reports arrive from other people: reload when the developer moves around or comes back to the tab.
  // ponytail: no live updates; add Supabase Realtime if moderators need them without clicking.
  addEventListener("hashchange", () => refresh());
  addEventListener("focus", () => refresh());
}

export function useStore(): State {
  useEffect(start, []);
  return useSyncExternalStore(subscribe, () => state, () => EMPTY);
}

type Who = Pick<AuthUser, "id" | "email" | "user_metadata">;
const fromState = (): Who | null => state.user && { id: state.user.id, email: state.user.email, user_metadata: { name: state.user.name } };

async function refresh(user: Who | null = fromState()) {
  if (!user) return set({ ready: true, user: null, apps: [], asc: null, play: null, emailAlerts: true });
  const sb = supabase();
  const [apps, releases, comments, reports, asc, play, alerts, bugs] = await Promise.all([
    sb.from("apps").select("*").order("created_at"),
    sb.from("releases").select("*"),
    sb.from("comments").select("*").order("created_at"),
    sb.from("reports").select("comment_id, reason"),
    sb.from("asc_connections").select("issuer_id, key_id, last_sync_at, last_error").maybeSingle(),
    sb.from("play_connections").select("client_email").maybeSingle(),
    sb.from("alert_settings").select("email_alerts").maybeSingle(),
    sb.from("bug_reports").select("*").order("created_at", { ascending: false }),
  ]);
  const err = apps.error || releases.error || comments.error || reports.error;
  if (err) { console.error(err); alert("Couldn't load your workspace: " + err.message); }
  const rep = Map.groupBy(reports.data || [], (r) => r.comment_id);
  const cm = Map.groupBy((comments.data || []).map((c): Comment => ({
    id: c.id, release_id: c.release_id, parent: c.parent_id, text: c.body, date: c.created_at, author: c.author_name,
    dev: c.is_dev, up: c.up_count, down: c.down_count, hidden: c.hidden, deleted: c.deleted, reports: rep.get(c.id) || [],
  })), (c) => c.release_id);
  const rel = Map.groupBy((releases.data || []).map((r): Release => ({
    id: r.id, app_id: r.app_id, version: r.version, date: r.release_date, notes: r.notes, published: r.published,
    up: r.up_count, down: r.down_count, comments: cm.get(r.id) || [], source: r.source as Release["source"],
    translations: (r.translations && typeof r.translations === "object" && !Array.isArray(r.translations) ? r.translations : {}) as Record<string, string>,
  })), (r) => r.app_id);
  const bg = Map.groupBy((bugs.data || []).map((b): Bug => ({
    id: b.id, app_id: b.app_id, version: b.version, text: b.body, device: b.device, screenshot: b.screenshot_path,
    author: b.reporter_name, resolved: b.resolved, date: b.created_at,
  })), (b) => b.app_id);
  set({
    ready: true,
    user: { id: user.id, email: user.email || "", name: user.user_metadata?.name || user.email || "" },
    apps: (apps.data || []).map((a): App => ({
      id: a.id, slug: a.slug, owner: a.owner_id, name: a.name, color: a.color, description: a.description,
      storeUrl: a.store_url, contact: a.contact, key: a.key, synced: a.synced_at, ascAppId: a.asc_app_id,
      proofMode: a.proof_mode as App["proofMode"], iosAppId: a.ios_app_id, iosAttestEnv: a.ios_attest_env as App["iosAttestEnv"], androidPackage: a.android_package,
      webhookUrl: a.webhook_url, releases: rel.get(a.id) || [], bugs: bg.get(a.id) || [],
    })),
    play: play.data ? { clientEmail: play.data.client_email } : null,
    emailAlerts: alerts.data?.email_alerts ?? true,
    asc: asc.data ? { issuerId: asc.data.issuer_id, keyId: asc.data.key_id, lastSyncAt: asc.data.last_sync_at, lastError: asc.data.last_error } : null,
  });
}

/** Error message, or null when it worked. */
export type Result = string | null;

// Runs a query, reloads, and returns an error message (or null). Errors without a form to show them get an alert.
async function run(query: PromiseLike<{ error: PostgrestError | null }>, { quiet = false, messages = {} as Record<string, string> } = {}): Promise<Result> {
  const { error } = await query;
  if (error) {
    const msg = messages[error.code] || error.message;
    if (!quiet) alert(msg);
    return msg;
  }
  await refresh();
  return null;
}

// Live dashboard: new comments, reports and votes on your apps arrive without reloading.
// RLS decides which changes each developer hears about.
// ponytail: any change reloads the whole workspace (debounced); patch single rows if workspaces get large.
let channel: RealtimeChannel | null = null;
let pending: ReturnType<typeof setTimeout> | undefined;
function live(on: boolean) {
  const sb = supabase();
  if (!on) { if (channel) sb.removeChannel(channel); channel = null; return; }
  if (channel) return;
  const later = () => { clearTimeout(pending); pending = setTimeout(() => refresh(), 400); };
  channel = sb.channel("dashboard");
  for (const table of ["comments", "reports", "releases", "bug_reports"]) channel.on("postgres_changes", { event: "*", schema: "public", table }, later);
  channel.subscribe();
}

// ---------- helpers ----------
export function rid(n = 10) {
  const a = "abcdefghjkmnpqrstuvwxyz23456789";
  let s = "";
  for (const x of crypto.getRandomValues(new Uint8Array(n))) s += a[x % a.length];
  return s;
}

export function slugify(s: string) {
  return s.toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/[\s_]+/g, "-").replace(/-+/g, "-").replace(/^-/, "").slice(0, 60) || "app";
}

export const currentUser = (s: State) => s.user;
function appBy(slug: string): App {
  const a = state.apps.find((x) => x.slug === slug);
  if (!a) throw new Error(`Unknown app ${slug}`);
  return a;
}
function relBy(slug: string, version: string): Release {
  const r = appBy(slug).releases.find((x) => x.version === version);
  if (!r) throw new Error(`Unknown release ${slug} ${version}`);
  return r;
}

export function sortedReleases(app: App, publishedOnly = false) {
  return app.releases
    .filter((r) => !publishedOnly || r.published)
    .slice()
    .sort((a, b) => (b.date || "").localeCompare(a.date || "") || b.version.localeCompare(a.version, undefined, { numeric: true }));
}

export function visibleComments(rel: Release) {
  return rel.comments.filter((c) => !c.hidden && !c.deleted);
}

// ---------- accounts ----------
export async function signup(name: string, email: string, password: string): Promise<Result> {
  email = email.trim().toLowerCase();
  if (!name.trim()) return "Please enter your name.";
  if (!/^\S+@\S+\.\S+$/.test(email)) return "Please enter a valid email.";
  if (password.length < 8) return "Use at least 8 characters for the password.";
  const { data, error } = await supabase().auth.signUp({
    email, password,
    options: { data: { name: name.trim() }, emailRedirectTo: `${location.origin}/auth/confirm?next=/` },
  });
  if (error) return error.code === "user_already_exists" ? "An account with this email already exists." : error.message;
  // With email confirmation on, Supabase returns no session (and, to hide which emails exist, no error for a taken email).
  if (!data.session) return CHECK_EMAIL;
  return null;
}

export async function login(email: string, password: string): Promise<Result> {
  if (email.trim().toLowerCase() === DEMO.email) return enterDemo();
  const { error } = await supabase().auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
  if (error) {
    if (error.code === "invalid_credentials") return "Wrong email or password.";
    if (error.code === "email_not_confirmed") return "Confirm your email first: open the link we sent you.";
    return error.message;
  }
  return null;
}

export const CHECK_EMAIL = "Almost done: open the link we emailed you to confirm your account.";

// Always reports success, so nobody can use this form to find out which emails have accounts.
export async function requestPasswordReset(email: string): Promise<Result> {
  if (!/^\S+@\S+\.\S+$/.test(email.trim())) return "Please enter a valid email.";
  const { error } = await supabase().auth.resetPasswordForEmail(email.trim().toLowerCase(), { redirectTo: `${location.origin}/auth/confirm?next=/reset-password` });
  if (error?.status === 429) return "Too many emails sent. Try again in a little while.";
  return null;
}

// Works after opening the reset link, which signs the person in for this one step.
export async function updatePassword(password: string): Promise<Result> {
  if (password.length < 8) return "Use at least 8 characters for the password.";
  const { data } = await supabase().auth.getSession();
  if (!data.session) return "This page only works from the link in the reset email. Ask for a new one.";
  if (data.session.user.email === DEMO.email) return "The demo account's password can't be changed.";
  const { error } = await supabase().auth.updateUser({ password });
  if (error) return error.code === "same_password" ? "That's already your password. Pick a new one." : error.message;
  return null;
}

// With the demo on (see demoEnabled), opening the app without an account drops you into the shared demo workspace.
let entering: Promise<Result> | null = null;
export function enterDemo(): Promise<Result> {
  entering ??= (async () => {
    const res = await fetch("/api/demo", { method: "POST" });
    if (!res.ok) return "The demo isn't available right now.";
    const { error } = await supabase().auth.signInWithPassword({ email: DEMO.email, password: DEMO.password });
    return error ? error.message : null;
  })().finally(() => { entering = null; });
  return entering;
}

export async function logout() {
  await supabase().auth.signOut();
}

// ---------- email alerts ----------
export async function setEmailAlerts(on: boolean): Promise<Result> {
  const sb = supabase();
  const id = state.user!.id;
  const { data, error } = await sb.from("alert_settings").update({ email_alerts: on }).eq("owner_id", id).select("owner_id");
  if (error) return error.message;
  if (!data.length) {
    const { error: e } = await sb.from("alert_settings").insert({ owner_id: id, email_alerts: on });
    if (e) return e.message;
  }
  await refresh();
  return null;
}

// ---------- profile ----------
export async function updateName(name: string): Promise<Result> {
  if (!name.trim()) return "Please enter your name.";
  const { error } = await supabase().auth.updateUser({ data: { name: name.trim() } });
  if (error) return error.message;
  await refresh();
  return null;
}

// Supabase emails a confirmation link to the new address (and the current one); the change applies once confirmed.
export async function changeEmail(email: string): Promise<Result> {
  email = email.trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email)) return "Please enter a valid email.";
  const { error } = await supabase().auth.updateUser({ email }, { emailRedirectTo: `${location.origin}/auth/confirm?next=/%23account` });
  if (error) return error.code === "email_exists" ? "Another account already uses that email." : error.message;
  return null;
}

// Asks for the current password first, so an unattended signed-in browser can't lock the owner out.
export async function changePassword(current: string, next: string): Promise<Result> {
  if (next.length < 8) return "Use at least 8 characters for the new password.";
  const email = state.user?.email || "";
  const check = await supabase().auth.signInWithPassword({ email, password: current });
  if (check.error) return "Your current password isn't right.";
  const { error } = await supabase().auth.updateUser({ password: next });
  if (error) return error.code === "same_password" ? "That's already your password. Pick a new one." : error.message;
  return null;
}

// Deletes the account and everything in it, then clears this browser's session.
export async function deleteAccount(confirmEmail: string): Promise<Result> {
  const res = await fetch("/api/account", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirm: confirmEmail }) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) return body?.error?.message || "Couldn't delete the account.";
  await supabase().auth.signOut({ scope: "local" });
  return null;
}

export async function resetDemo() {
  const res = await fetch("/api/demo", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reset: true }) });
  if (!res.ok) alert("Couldn't reset the demo.");
  await refresh();
}

// ---------- apps & releases ----------
export async function addApp({ name, description, storeUrl, contact, color }: AppFields): Promise<{ slug: string } | { error: string }> {
  const base = slugify(name);
  for (let i = 0; i < 4; i++) {
    const slug = i ? `${base}-${rid(3)}` : base;
    const err = await run(supabase().from("apps").insert({ slug, name: name.trim(), description: description.trim(), store_url: storeUrl.trim(), contact: contact.trim(), color, key: "clk_" + rid(16) }), { quiet: true });
    if (!err) return { slug };
    if (!/duplicate|apps_slug_check/.test(err)) return { error: err };
  }
  return { error: "Couldn't find a free web address for this app. Try another name." };
}

export function updateApp(slug: string, { name, description, storeUrl, contact, color }: AppFields) {
  return run(supabase().from("apps").update({ name, description, store_url: storeUrl, contact, color }).eq("id", appBy(slug).id));
}

// New public key; the old one stops working at once.
export function rotateKey(slug: string) {
  return run(supabase().from("apps").update({ key: "clk_" + rid(16) }).eq("id", appBy(slug).id));
}

export function deleteApp(slug: string) {
  return run(supabase().from("apps").delete().eq("id", appBy(slug).id));
}

export async function addRelease(slug: string, { version, notes, published, date }: { version: string; notes: string; published: boolean; date: string }): Promise<Result> {
  const app = appBy(slug);
  const err = await run(supabase().from("releases").insert({ app_id: app.id, version, notes, published, release_date: date }), { quiet: true, messages: { 23505: "This version already exists." } });
  if (err) return err;
  await run(supabase().from("apps").update({ synced_at: new Date().toISOString() }).eq("id", app.id));
  return null;
}

export function updateRelease(slug: string, version: string, { notes, date, published, translations }: { notes?: string; date?: string; published?: boolean; translations?: Record<string, string> }) {
  return run(supabase().from("releases").update({ notes, release_date: date, published, translations }).eq("id", relBy(slug, version).id));
}

export function setWebhook(slug: string, url: string) {
  return run(supabase().from("apps").update({ webhook_url: url.trim() || null }).eq("id", appBy(slug).id),
    { quiet: true, messages: { "23514": "Use a full https:// address." } });
}
export async function testWebhook(slug: string): Promise<Result> {
  return (await call("/api/webhook-test", "POST", { appId: appBy(slug).id })).error || null;
}

// ---------- bug reports ----------
export function setBugResolved(id: string, resolved: boolean) {
  return run(supabase().from("bug_reports").update({ resolved }).eq("id", id));
}
export async function deleteBug(bug: Bug) {
  if (bug.screenshot) await supabase().storage.from("screenshots").remove([bug.screenshot]);
  return run(supabase().from("bug_reports").delete().eq("id", bug.id));
}
// Screenshots are private: a signed address that works for ten minutes.
export async function screenshotUrl(path: string) {
  const { data } = await supabase().storage.from("screenshots").createSignedUrl(path, 600);
  return data?.signedUrl || null;
}

export function deleteRelease(slug: string, version: string) {
  return run(supabase().from("releases").delete().eq("id", relBy(slug, version).id));
}

// ---------- moderation ----------
// Developer reply. Anonymous comments only come in through /api/v1/sdk.
export function addComment(slug: string, version: string, text: string, parent: string | null = null) {
  return run(supabase().from("comments").insert({ release_id: relBy(slug, version).id, parent_id: parent, body: text.trim(), author_name: state.user?.name || "Developer", is_dev: true }));
}

export function setHidden(id: string, hidden: boolean) {
  return run(supabase().from("comments").update({ hidden }).eq("id", id));
}

export function dismissReports(id: string) {
  return run(supabase().from("reports").delete().eq("comment_id", id));
}

// ---------- App Store Connect (through the server, which holds the key) ----------
async function call<T = unknown>(path: string, method: string, body?: unknown): Promise<{ data?: T; error?: string }> {
  const res = await fetch(path, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  return res.ok ? { data } : { error: data?.error?.message || "Something went wrong." };
}

export async function ascConnect(issuerId: string, keyId: string, privateKey: string): Promise<Result> {
  const r = await call("/api/asc/connection", "POST", { issuerId, keyId, privateKey });
  await refresh();
  return r.error || null;
}
export async function ascDisconnect(): Promise<Result> {
  const r = await call("/api/asc/connection", "DELETE");
  await refresh();
  return r.error || null;
}
export async function ascApps() {
  return call<{ apps: AscApp[] }>("/api/asc/apps", "GET");
}
export async function ascLink(slug: string, ascAppId: string | null) {
  const r = await call<{ imported: number; published: number }>("/api/asc/link", "POST", { appId: appBy(slug).id, ascAppId });
  await refresh();
  return r;
}
export async function ascSync(slug: string) {
  const r = await call<{ imported: number; published: number }>("/api/asc/sync", "POST", { appId: appBy(slug).id });
  await refresh();
  return r;
}

// ---------- app proofs ----------
export function updateProofs(slug: string, p: { proofMode: App["proofMode"]; iosAppId: string; iosAttestEnv: App["iosAttestEnv"]; androidPackage: string }) {
  return run(supabase().from("apps").update({
    proof_mode: p.proofMode, ios_app_id: p.iosAppId.trim() || null, ios_attest_env: p.iosAttestEnv, android_package: p.androidPackage.trim() || null,
  }).eq("id", appBy(slug).id), { quiet: true, messages: { "23514": "Check the iOS App ID (TEAMID.bundle.id) and the Android package name." } });
}
export async function playConnect(json: string): Promise<Result> {
  const r = await call("/api/play/connection", "POST", { json });
  await refresh();
  return r.error || null;
}
export async function playDisconnect(): Promise<Result> {
  const r = await call("/api/play/connection", "DELETE");
  await refresh();
  return r.error || null;
}

// ---------- visitors and simulated devices ----------
// A browser visitor (or a pretend phone) is an anonymous install, exactly like a real app using the package.
export function installId(storageKey = "changelark:install") {
  let id = localStorage.getItem(storageKey);
  if (!id) { id = rid(24); localStorage.setItem(storageKey, id); }
  return id;
}

export function sdkClient(appKey: string, anonId = installId(), appVersion = "web", locale?: string) {
  return createClient({ baseUrl: location.origin, appKey, anonId, appVersion, locale });
}

export const { versionParts, normVersion, cmpVersion, badge } = decider;

// ---------- formatting ----------
const asDate = (d: string) => new Date(d + (d.length === 10 ? "T12:00:00Z" : ""));
export function fmtLong(d: string) {
  return asDate(d).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}
export function fmtShort(d: string) {
  return asDate(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}
export function fmtSync(iso: string) {
  const d = new Date(iso);
  const day = d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  const t = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" });
  return `${day}, ${t} UTC`;
}
export function changelogHref(app: Pick<App, "slug">, version?: string, lang?: string) {
  return `/apps/${app.slug}${version ? `/${encodeURIComponent(version)}` : ""}${lang ? `?lang=${lang}` : ""}`;
}
