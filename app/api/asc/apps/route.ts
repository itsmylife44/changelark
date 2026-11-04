// The App Store apps this developer's key can see, to choose one to link.
import { currentDev, json, fail } from "../../../../lib/server";
import { keyFor, listAscApps } from "../../../../lib/asc";
import { ascFailure } from "../errors";

export async function GET() {
  const dev = await currentDev();
  if (!dev) return fail(401, "signed_out", "Log in first.");
  const key = await keyFor(dev.id);
  if (!key) return fail(400, "not_connected", "Connect App Store Connect in Account first.");
  try { return json({ apps: await listAscApps(key) }); } catch (e) { return ascFailure(e); }
}
