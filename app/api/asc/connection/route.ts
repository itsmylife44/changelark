// Save or remove the developer's App Store Connect API key. The key is checked against Apple before it is stored.
import { admin, currentDev, json, fail } from "../../../../lib/server";
import { listAscApps } from "../../../../lib/asc";
import { DEMO } from "../../../../lib/demo-account";
import { ascFailure } from "../errors";

export async function POST(req: Request) {
  const dev = await currentDev();
  if (!dev) return fail(401, "signed_out", "Log in first.");
  if (dev.email === DEMO.email) return fail(403, "demo", "The shared demo account can't store an App Store Connect key.");
  const b = await req.json().catch(() => ({}));
  const issuerId = String(b.issuerId || "").trim().toLowerCase();
  const keyId = String(b.keyId || "").trim().toUpperCase();
  const privateKey = String(b.privateKey || "").trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(issuerId)) return fail(400, "issuer", "The Issuer ID looks like 57246542-96fe-1a63-e053-0824d011072a.");
  if (!/^[A-Z0-9]{10}$/.test(keyId)) return fail(400, "key_id", "The Key ID is 10 letters and numbers, like 2X9R4HXF34.");
  if (!/^-----BEGIN PRIVATE KEY-----[\s\S]+-----END PRIVATE KEY-----$/.test(privateKey)) return fail(400, "private_key", "Paste the whole .p8 file, from BEGIN PRIVATE KEY to END PRIVATE KEY.");
  let apps;
  try { apps = await listAscApps({ issuerId, keyId, privateKey }); } catch (e) { return ascFailure(e); }
  const { error } = await admin().rpc("asc_save_key", { p_owner: dev.id, p_issuer: issuerId, p_key_id: keyId, p_private_key: privateKey });
  if (error) { console.error(error); return fail(500, "save_failed", "Couldn't save the key."); }
  return json({ apps: apps.length });
}

export async function DELETE() {
  const dev = await currentDev();
  if (!dev) return fail(401, "signed_out", "Log in first.");
  const db = admin();
  await db.from("apps").update({ asc_app_id: null }).eq("owner_id", dev.id);
  const { error } = await db.from("asc_connections").delete().eq("owner_id", dev.id); // the trigger deletes the Vault secret
  if (error) return fail(500, "delete_failed", "Couldn't disconnect.");
  return json({ ok: true });
}
