// RSS 2.0 feed of an app's published versions, for feed readers, Slack's /feed and anything that polls.
import { admin } from "../../../../lib/server";
import { publishedReleases } from "../../../../lib/sdk-data";
import { SITE_URL } from "../../../../lib/site-url";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const db = admin();
  const { data: app } = await db.from("apps").select("id, slug, name, description").eq("slug", slug).maybeSingle();
  if (!app) return new Response("Not found", { status: 404 });
  const page = `${SITE_URL}/apps/${app.slug}`;
  const items = (await publishedReleases(db, app.id, { offset: 0, limit: 49 })).map((r) => `
    <item>
      <title>${esc(`${app.name} ${r.version}`)}</title>
      <link>${page}/${encodeURIComponent(r.version)}</link>
      <guid isPermaLink="false">${r.id}</guid>
      <pubDate>${new Date(r.release_date + "T12:00:00Z").toUTCString()}</pubDate>
      <description>${esc(r.notes)}</description>
    </item>`).join("");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${esc(`${app.name} — What's new`)}</title>
    <link>${page}</link>
    <atom:link href="${page}/feed.xml" rel="self" type="application/rss+xml"/>
    <description>${esc(app.description.split("\n")[0] || `Release notes for ${app.name}`)}</description>${items}
  </channel>
</rss>
`;
  return new Response(xml, { headers: { "Content-Type": "application/rss+xml; charset=utf-8", "Cache-Control": "public, max-age=300" } });
}
