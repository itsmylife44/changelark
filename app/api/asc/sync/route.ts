// "Sync now" for one linked app.
import { currentDev, json, fail } from "../../../../lib/server";
import { syncOwner } from "../../../../lib/asc";
import { ascFailure } from "../errors";

export async function POST(req: Request) {
  const dev = await currentDev();
  if (!dev) return fail(401, "signed_out", "Log in first.");
  const { appId } = await req.json().catch(() => ({}));
  try { return json(await syncOwner(dev.id, String(appId || ""))); } catch (e) { return ascFailure(e); }
}
