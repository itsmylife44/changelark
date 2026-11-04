// Email digest: one message per developer with the comments and reports since the last one.
// Call with "Authorization: Bearer $CRON_SECRET" (vercel.json runs it daily). Needs SMTP_URL.
import { admin, json, fail } from "../../../../lib/server";
import { mailer, FROM, escapeHtml } from "../../../../lib/mail";
import { SITE_URL } from "../../../../lib/site-url";
import { DEMO } from "../../../../lib/demo-account";

export const maxDuration = 300;
const MAX_LISTED = 10;

const plural = (n: number, w: string) => `${n} new ${w}${n === 1 ? "" : "s"}`;
const quote = (s: string) => (s.length > 140 ? s.slice(0, 139).trimEnd() + "…" : s);

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return fail(503, "disabled", "Set CRON_SECRET to enable scheduled jobs.");
  if (req.headers.get("authorization") !== `Bearer ${secret}`) return fail(401, "unauthorized", "Wrong or missing cron secret.");
  const mail = mailer();
  if (!mail) return fail(503, "no_smtp", "Set SMTP_URL to send email alerts.");

  const db = admin();
  const now = new Date().toISOString();
  const [{ data: apps }, { data: settings }] = await Promise.all([
    db.from("apps").select("id, name, owner_id"),
    db.from("alert_settings").select("owner_id, email_alerts, last_sent_at"),
  ]);
  const byOwner = Map.groupBy(apps || [], (a) => a.owner_id);
  const prefs = new Map((settings || []).map((s) => [s.owner_id, s]));
  const out = { developers: 0, sent: 0, failed: 0 };

  // ponytail: one developer at a time; batch the queries if there are ever thousands of developers.
  for (const [owner, ownApps] of byOwner) {
    const pref = prefs.get(owner);
    if (pref?.email_alerts === false) continue;
    out.developers++;
    const since = pref?.last_sent_at || new Date(Date.now() - 86_400_000).toISOString();
    const appName = new Map(ownApps.map((a) => [a.id, a.name]));
    const { data: releases } = await db.from("releases").select("id, app_id, version").in("app_id", ownApps.map((a) => a.id));
    const rel = new Map((releases || []).map((r) => [r.id, r]));
    const relIds = [...rel.keys()];
    if (!relIds.length) continue;
    const [{ data: comments }, { data: reportRows }] = await Promise.all([
      db.from("comments").select("release_id, author_name, body, created_at").in("release_id", relIds).eq("is_dev", false).eq("deleted", false).gt("created_at", since).order("created_at"),
      db.from("reports").select("reason, created_at, comments!inner(release_id)").in("comments.release_id", relIds).gt("created_at", since),
    ]);
    const newComments = comments || [];
    const reports = reportRows || [];
    if (!newComments.length && !reports.length) continue;

    const { data: user } = await db.auth.admin.getUserById(owner);
    const to = user?.user?.email;
    if (!to || to === DEMO.email) continue;

    const where = (releaseId: string) => { const r = rel.get(releaseId)!; return `${appName.get(r.app_id)} ${r.version}`; };
    const listed = newComments.slice(0, MAX_LISTED);
    const extra = newComments.length - listed.length;
    const subject = [newComments.length && plural(newComments.length, "comment"), reports.length && plural(reports.length, "report")].filter(Boolean).join(" and ") + " on your apps";
    const text = [
      `Here's what happened on your apps since ${since.slice(0, 10)}.`,
      "",
      ...listed.map((c) => `${where(c.release_id)}: ${c.author_name} wrote "${quote(c.body)}"`),
      ...(extra > 0 ? [`…and ${extra} more.`] : []),
      ...(reports.length ? ["", `${plural(reports.length, "report")} to review: ${SITE_URL}/#reports`] : []),
      "",
      `Read and reply: ${SITE_URL}/#comments`,
      `Turn these emails off in Account: ${SITE_URL}/#account`,
    ].join("\n");
    const html = `<p>Here's what happened on your apps since ${escapeHtml(since.slice(0, 10))}.</p>
<ul>${listed.map((c) => `<li><b>${escapeHtml(where(c.release_id))}</b> · ${escapeHtml(c.author_name)}: “${escapeHtml(quote(c.body))}”</li>`).join("")}</ul>
${extra > 0 ? `<p>…and ${extra} more.</p>` : ""}
${reports.length ? `<p><b>${plural(reports.length, "report")}</b> to review: <a href="${SITE_URL}/#reports">open reports</a></p>` : ""}
<p><a href="${SITE_URL}/#comments">Read and reply</a></p>
<p style="color:#5e646b;font-size:12px">You get this because email alerts are on. <a href="${SITE_URL}/#account">Turn them off</a>.</p>`;

    try {
      await mail.sendMail({ from: FROM, to, subject, text, html });
      await db.from("alert_settings").upsert({ owner_id: owner, last_sent_at: now }, { onConflict: "owner_id" });
      out.sent++;
    } catch (e) {
      console.error(e);
      out.failed++; // try again next run: last_sent_at stays where it was
    }
  }
  return json(out);
}
