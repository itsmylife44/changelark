// "Send a test" next to the webhook field: posts a sample message so the developer sees it arrive.
import { admin, currentDev, json, fail } from "../../../lib/server";
import { webhookAllowed, sendWebhook } from "../../../lib/feedback";

export async function POST(req: Request) {
  const dev = await currentDev();
  if (!dev) return fail(401, "signed_out", "Log in first.");
  const { appId } = await req.json().catch(() => ({}));
  const { data: app } = await admin().from("apps").select("name, webhook_url").eq("id", String(appId || "")).eq("owner_id", dev.id).maybeSingle();
  if (!app) return fail(404, "app_not_found", "App not found.");
  if (!app.webhook_url) return fail(400, "no_webhook", "Save a webhook address first.");
  if (!webhookAllowed(app.webhook_url)) return fail(400, "webhook_not_allowed", "Use a public https:// address.");
  try {
    const status = await sendWebhook(app.webhook_url, "test", `👋 Changelark is connected. New feedback on ${app.name} will show up here.`);
    if (status >= 300) return fail(502, "webhook_refused", `The webhook answered ${status}. Check the address.`);
  } catch {
    return fail(502, "webhook_unreachable", "The webhook didn't answer. Check the address.");
  }
  return json({ ok: true });
}
