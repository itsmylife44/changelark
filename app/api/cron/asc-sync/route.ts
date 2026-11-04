// Scheduled import for every developer with linked apps (daily in vercel.json; hourly needs a paid Vercel plan). Call with "Authorization: Bearer $CRON_SECRET"
// (Vercel Cron does this for you; elsewhere, any scheduler that can send a request works).
import { admin, json, fail } from "../../../../lib/server";
import { syncOwner } from "../../../../lib/asc";

export const maxDuration = 300;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return fail(503, "disabled", "Set CRON_SECRET to enable scheduled imports.");
  if (req.headers.get("authorization") !== `Bearer ${secret}`) return fail(401, "unauthorized", "Wrong or missing cron secret.");
  const { data: rows, error } = await admin().from("apps").select("owner_id").not("asc_app_id", "is", null);
  if (error) return fail(500, "db", error.message);
  const owners = [...new Set(rows.map((r) => r.owner_id))];
  const out = { developers: owners.length, imported: 0, published: 0, failed: 0 };
  // ponytail: one developer at a time; parallelize with a small pool if this ever gets slow.
  for (const owner of owners) {
    try { const r = await syncOwner(owner); out.imported += r.imported; out.published += r.published; }
    catch { out.failed++; } // the error is stored on that developer's connection and shown in their dashboard
  }
  return json(out);
}
