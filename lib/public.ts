// Server-side data for the public changelog pages, so search engines (and people without JavaScript) get full HTML.
// Rendered for "nobody": no device, so no personal votes or blocks. The page refreshes those in the browser.
import { cache } from "react";
import { admin, signedInUserId } from "./server";
import { publishedReleases, serializeReleases, commentTree, type Ctx } from "./sdk-data";
import type { ApiComment, ApiRelease } from "../sdk/react-native/src/client";
import type { PublicApp } from "../app/api/v1/public/[slug]/route";

export interface ChangelogData { app: PublicApp; releases: ApiRelease[]; comments: ApiComment[] | null }

// cache(): generateMetadata and the page share one load per request.
export const loadChangelog = cache(async (slug: string, version?: string, lang?: string): Promise<ChangelogData | null> => {
  const db = admin();
  const { data: row } = await db.from("apps")
    .select("id, slug, name, color, description, store_url, contact, key, owner_id, proof_mode").eq("slug", slug).maybeSingle();
  if (!row) return null;
  const releases = await serializeReleases(db, "", await publishedReleases(db, row.id), lang || null);
  let comments: ApiComment[] | null = null;
  if (version) {
    const r = releases.find((x) => x.version === version);
    if (!r) return null;
    const nobody: Ctx = { db, app: { id: row.id, name: row.name, color: row.color }, tag: "", inst: { guidelines_accepted_at: null, blocked_tags: [] } };
    comments = await commentTree(nobody, r.id);
  }
  const { id: _id, owner_id, store_url, proof_mode, ...rest } = row;
  return { app: { ...rest, storeUrl: store_url, readOnly: proof_mode === "required", isOwner: owner_id === (await signedInUserId()) }, releases, comments };
});

// First paragraph, trimmed to a search-result-sized description.
export function summary(text: string, fallback: string) {
  const first = text.split(/\n\s*\n/)[0].replace(/\s+/g, " ").trim();
  if (!first) return fallback;
  return first.length > 155 ? first.slice(0, 154).trimEnd() + "…" : first;
}

// ?lang=it or ?lang=pt-br; anything else is ignored.
export const langParam = (v: unknown) => (typeof v === "string" && /^[a-z]{2,3}(-[a-z]{2,4})?$/i.test(v) ? v.toLowerCase() : undefined);
