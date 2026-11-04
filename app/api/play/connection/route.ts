// Save or remove the Google service account used to decode Play Integrity tokens. Checked with Google before it's stored.
import { admin, currentDev, json, fail } from "../../../../lib/server";
import { parseServiceAccount, checkServiceAccount } from "../../../../lib/play";
import { ProofError } from "../../../../lib/attest";
import { DEMO } from "../../../../lib/demo-account";

export async function POST(req: Request) {
  const dev = await currentDev();
  if (!dev) return fail(401, "signed_out", "Log in first.");
  if (dev.email === DEMO.email) return fail(403, "demo", "The shared demo account can't store a Google key.");
  const { json: text } = await req.json().catch(() => ({}));
  let sa;
  try { sa = parseServiceAccount(String(text || "")); } catch (e) { return fail(400, "bad_key", (e as ProofError).message); }
  try { await checkServiceAccount(sa); }
  catch (e) { return fail(400, "google_refused", e instanceof ProofError ? e.message : "The private key in that file can't be read."); }
  const { error } = await admin().rpc("play_save_key", { p_owner: dev.id, p_client_email: sa.client_email, p_json: String(text) });
  if (error) { console.error(error); return fail(500, "save_failed", "Couldn't save the key."); }
  return json({ clientEmail: sa.client_email });
}

export async function DELETE() {
  const dev = await currentDev();
  if (!dev) return fail(401, "signed_out", "Log in first.");
  const { error } = await admin().from("play_connections").delete().eq("owner_id", dev.id); // the trigger deletes the Vault secret
  if (error) return fail(500, "delete_failed", "Couldn't disconnect.");
  return json({ ok: true });
}
