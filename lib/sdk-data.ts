// Reads published changelog data for the SDK API and the server-rendered public pages.
// Server only (uses the secret-key client passed in as ctx.db).
import type { PostgrestError } from "@supabase/supabase-js";
import { fail, type Db } from "./server";
import type { Tables } from "./database.types";
import type { Vote } from "../sdk/react-native/src/decider";
import type { ApiComment, ApiRelease } from "../sdk/react-native/src/client";
import { pickNotes } from "./feedback";

export type ReleaseRow = Pick<Tables<"releases">, "id" | "version" | "notes" | "translations" | "release_date" | "up_count" | "down_count">;
export interface Ctx {
  db: Db;
  app: Pick<Tables<"apps">, "id" | "name" | "color">;
  tag: string;
  inst: Pick<Tables<"installs">, "guidelines_accepted_at" | "blocked_tags">;
}

// Unwraps a Supabase result to its success data, or stops the request with a 500.
export type Ok<R> = Extract<R, { error: null }> extends { data: infer D } ? D : never;
export function must<R extends { data: unknown; error: PostgrestError | null }>(res: R): Ok<R> {
  if (res.error) throw fail(500, "db", res.error.message);
  return res.data as Ok<R>;
}

export async function myVotes(db: Db, tag: string, column: "release_id" | "comment_id", ids: string[]) {
  const out = new Map<string, Vote>();
  if (!ids.length || !tag) return out;
  const rows = must(await db.from("votes").select("release_id, comment_id, value").eq("voter_tag", tag).in(column, ids));
  for (const v of rows) out.set(v[column]!, v.value as Vote);
  return out;
}

export const today = () => new Date().toISOString().slice(0, 10);
export const RELEASE_COLS = "id, version, notes, translations, release_date, up_count, down_count";

export async function publishedReleases(db: Db, appId: string, page?: { offset: number; limit: number }): Promise<ReleaseRow[]> {
  let q = db.from("releases").select(RELEASE_COLS)
    .eq("app_id", appId).eq("published", true).lte("release_date", today())
    .order("release_date", { ascending: false }).order("created_at", { ascending: false });
  if (page) q = q.range(page.offset, page.offset + page.limit); // one extra row tells whether there's a next page
  return must(await q);
}

// Cursors are offsets, opaque to clients. ponytail: offsets can skip or repeat an item if one is added mid-scroll;
// switch to keyset cursors if that ever matters.
export function pageParams(q: URLSearchParams, fallback = 50) {
  const offset = Math.max(0, parseInt(q.get("cursor") || "0", 10) || 0);
  const limit = Math.min(100, Math.max(1, parseInt(q.get("limit") || String(fallback), 10) || fallback));
  return { offset, limit };
}

export function paged<T>(items: T[], { offset, limit }: { offset: number; limit: number }) {
  return { items: items.slice(0, limit), nextCursor: items.length > limit ? String(offset + limit) : null };
}

export async function serializeReleases(db: Db, tag: string, rows: ReleaseRow[], locale: string | null = null): Promise<ApiRelease[]> {
  const ids = rows.map((r) => r.id);
  const votes = await myVotes(db, tag, "release_id", ids);
  // ponytail: counts comments in JS; switch to a counter column if releases get thousands of comments.
  const counts = new Map<string, number>();
  if (ids.length) {
    const cs = must(await db.from("comments").select("release_id").in("release_id", ids).eq("hidden", false).eq("deleted", false));
    for (const c of cs) counts.set(c.release_id, (counts.get(c.release_id) || 0) + 1);
  }
  return rows.map((r) => ({
    id: r.id, version: r.version, ...pickNotes(r.notes, r.translations, locale), date: r.release_date,
    upCount: r.up_count, downCount: r.down_count, myVote: votes.get(r.id) || 0, commentCount: counts.get(r.id) || 0,
  }));
}

export async function findRelease(ctx: Ctx, version: string): Promise<ReleaseRow> {
  const r = must(await ctx.db.from("releases").select(RELEASE_COLS)
    .eq("app_id", ctx.app.id).eq("version", version).eq("published", true).lte("release_date", today()).maybeSingle());
  if (!r) throw fail(404, "release_not_found", "No published release with that version.");
  return r;
}

export async function findComment(ctx: Ctx, id: unknown): Promise<Tables<"comments">> {
  if (typeof id !== "string" || !/^[0-9a-f-]{36}$/.test(id)) throw fail(404, "comment_not_found", "Comment not found.");
  const c = must(await ctx.db.from("comments").select("*").eq("id", id).maybeSingle());
  const r = c && must(await ctx.db.from("releases").select("published").eq("id", c.release_id).eq("app_id", ctx.app.id).maybeSingle());
  if (!c || !r?.published) throw fail(404, "comment_not_found", "Comment not found.");
  return c;
}

// Comment tree for one release, minus what this device blocked or reported.
export async function commentTree(ctx: Ctx, releaseId: string, rootId: string | null = null): Promise<ApiComment[]> {
  const rows = must(await ctx.db.from("comments").select("*").eq("release_id", releaseId).order("created_at", { ascending: false }));
  const ids = rows.map((c) => c.id);
  const reported = new Set(ids.length && ctx.tag ? must(await ctx.db.from("reports").select("comment_id").eq("reporter_tag", ctx.tag).in("comment_id", ids)).map((r) => r.comment_id) : []);
  const blocked = new Set(ctx.inst.blocked_tags);
  const votes = await myVotes(ctx.db, ctx.tag, "comment_id", ids);
  const byId = new Map<string, ApiComment>();
  for (const c of rows) {
    if (reported.has(c.id) || (c.author_tag && blocked.has(c.author_tag))) continue;
    const removed = c.hidden || c.deleted;
    byId.set(c.id, {
      id: c.id, parentId: c.parent_id, createdAt: c.created_at,
      body: removed ? "" : c.body,
      status: c.deleted ? "deleted" : c.hidden ? "hidden" : "visible",
      removed, deletedByAuthor: c.deleted,
      upCount: c.up_count, downCount: c.down_count, myVote: votes.get(c.id) || 0,
      author: { name: c.author_name, kind: c.is_dev ? "developer" : "user", isMe: !!ctx.tag && c.author_tag === ctx.tag },
      replies: [],
    });
  }
  const roots: ApiComment[] = [];
  for (const c of [...byId.values()].reverse()) {
    if (c.parentId === rootId) roots.push(c);
    else if (c.parentId) byId.get(c.parentId)?.replies.push(c); // replies to removed parents disappear with them
  }
  return roots.reverse(); // newest threads first, replies oldest first
}

