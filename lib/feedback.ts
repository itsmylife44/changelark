// Closing the loop: pick the notes in the reader's language, and tell the developer about new feedback right away.
// Server only.
import { SITE_URL } from "./site-url";
import type { Db } from "./server";

// "it-IT" → the "it-it" translation, then "it", else the developer's original notes.
export function pickNotes(notes: string, translations: unknown, locale: string | null) {
  const t = (translations && typeof translations === "object" ? translations : {}) as Record<string, string>;
  const languages = Object.keys(t).filter((k) => typeof t[k] === "string" && t[k].trim()).sort();
  const want = (locale || "").toLowerCase().replace("_", "-");
  const hit = [want, want.split("-")[0]].find((k) => k && languages.includes(k));
  return { notes: hit ? t[hit] : notes, language: hit || null, languages };
}

// Only public http(s) hosts. Local addresses are allowed in development (WEBHOOK_ALLOW_LOCAL=1) for tests.
// ponytail: checks the host name, not where DNS points; put the server behind an egress proxy if that matters.
export function webhookAllowed(raw: string) {
  let u: URL;
  try { u = new URL(raw); } catch { return false; }
  if (process.env.WEBHOOK_ALLOW_LOCAL === "1") return /^https?:$/.test(u.protocol);
  const h = u.hostname;
  const local = h === "localhost" || h.endsWith(".local") || h.endsWith(".internal") || /^[\d.]+$/.test(h) || h.includes(":");
  return u.protocol === "https:" && !local;
}

// Slack, Discord and Telegram want their own field; anything else gets the full event.
// Telegram: paste https://api.telegram.org/bot<TOKEN>/sendMessage?chat_id=<ID> (chat_id rides in the query).
function payload(url: string, event: string, text: string, link: string) {
  const host = new URL(url).hostname;
  if (host.endsWith("slack.com")) return { text: `${text}\n<${link}|Open the inbox>` };
  if (host.endsWith("discord.com") || host.endsWith("discordapp.com")) return { content: `${text}\n${link}` };
  if (host === "api.telegram.org") return { text: `${text}\n${link}` };
  return { event, text, url: link };
}

export type FeedbackEvent = "comment" | "report" | "bug";

// Posts one message. Returns the HTTP status, or throws if the address doesn't answer.
export async function sendWebhook(url: string, event: FeedbackEvent | "test", text: string, link = `${SITE_URL}/#inbox`) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": "Changelark-Webhook" },
    body: JSON.stringify(payload(url, event, text, link)),
    signal: AbortSignal.timeout(4000),
    redirect: "error",
  });
  return r.status;
}

// For new feedback: never throws and runs after the response, so the user never waits for it.
export async function notifyWebhook(db: Db, appId: string, event: FeedbackEvent, text: string) {
  try {
    const { data } = await db.from("apps").select("webhook_url").eq("id", appId).maybeSingle();
    if (!data?.webhook_url || !webhookAllowed(data.webhook_url)) return;
    await sendWebhook(data.webhook_url, event, text, `${SITE_URL}/#inbox${event === "bug" ? "/bugs" : ""}`);
  } catch (e) {
    console.warn("webhook failed:", (e as Error).message);
  }
}

export const quote = (s: string, max = 280) => `“${s.length > max ? s.slice(0, max - 1) + "…" : s}”`;
