// Deletes the signed-in developer's account and, by cascade, every app, release, comment, vote and report under it.
import { admin, userClient, json, fail } from "../../../lib/server";
import { DEMO } from "../../../lib/demo-account";

export async function DELETE(req: Request) {
  const sb = await userClient();
  const { data } = await sb.auth.getClaims();
  const id = data?.claims?.sub;
  const email = String(data?.claims?.email || "").toLowerCase();
  if (!id) return fail(401, "signed_out", "Log in first.");
  if (email === DEMO.email) return fail(403, "demo", "The demo account can't be deleted.");
  const { confirm } = await req.json().catch(() => ({}));
  if (typeof confirm !== "string" || confirm.trim().toLowerCase() !== email) return fail(400, "confirm", "Type your email exactly to confirm.");
  const { error } = await admin().auth.admin.deleteUser(id);
  if (error) { console.error(error); return fail(500, "delete_failed", "Couldn't delete the account. Nothing was removed."); }
  await sb.auth.signOut({ scope: "local" }).catch(() => {}); // clears the session cookies
  return json({ ok: true });
}
