import type { MetadataRoute } from "next";
import { admin } from "../lib/server";
import { SITE_URL } from "../lib/site-url";

// Every public changelog and every live version. Drafts and future releases stay out.
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const db = admin();
  const today = new Date().toISOString().slice(0, 10);
  const [{ data: apps }, { data: releases }] = await Promise.all([
    db.from("apps").select("id, slug, synced_at"),
    db.from("releases").select("app_id, version, release_date").eq("published", true).lte("release_date", today),
  ]);
  const slugs = new Map((apps || []).map((a) => [a.id, a.slug]));
  return [
    { url: `${SITE_URL}/docs` },
    { url: `${SITE_URL}/docs/react-native` },
    ...(apps || []).map((a) => ({ url: `${SITE_URL}/apps/${a.slug}`, lastModified: a.synced_at })),
    ...(releases || []).filter((r) => slugs.has(r.app_id)).map((r) => ({ url: `${SITE_URL}/apps/${slugs.get(r.app_id)}/${r.version}`, lastModified: r.release_date })),
  ];
}
