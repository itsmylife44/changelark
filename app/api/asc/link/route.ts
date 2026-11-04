// Link a Changelark app to an App Store app (only one the developer's key can see), or unlink it. Imports right away.
import { admin, currentDev, json, fail } from "../../../../lib/server";
import { keyFor, listAscApps, syncOwner } from "../../../../lib/asc";
import { ascFailure } from "../errors";

export async function POST(req: Request) {
  const dev = await currentDev();
  if (!dev) return fail(401, "signed_out", "Log in first.");
  const { appId, ascAppId } = await req.json().catch(() => ({}));
  const db = admin();
  const { data: app } = await db.from("apps").select("id").eq("id", String(appId || "")).eq("owner_id", dev.id).maybeSingle();
  if (!app) return fail(404, "app_not_found", "App not found.");
  if (ascAppId === null) {
    await db.from("apps").update({ asc_app_id: null }).eq("id", app.id);
    return json({ ok: true });
  }
  const key = await keyFor(dev.id);
  if (!key) return fail(400, "not_connected", "Connect App Store Connect in Account first.");
  try {
    // Linking only works for apps this key can read, which also shows the app belongs to this developer.
    if (!(await listAscApps(key)).some((a) => a.id === String(ascAppId))) return fail(403, "not_your_app", "Your App Store Connect key can't see that app.");
    await db.from("apps").update({ asc_app_id: String(ascAppId) }).eq("id", app.id);
    return json(await syncOwner(dev.id, app.id));
  } catch (e) { return ascFailure(e); }
}
