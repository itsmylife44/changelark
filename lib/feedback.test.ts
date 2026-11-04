// Run: node --test lib/feedback.test.ts (Node 24 strips the types itself).
import { registerHooks } from "node:module";
import { test } from "node:test";
import assert from "node:assert/strict";

// Next.js imports have no extension; teach Node to try ".ts".
registerHooks({
  resolve(s, c, next) {
    try { return next(s, c); } catch (e) { if (s.startsWith(".")) return next(s + ".ts", c); throw e; }
  },
});
const { sendWebhook } = await import("./feedback");

// Stub the network and return the JSON body that would have been posted.
async function bodyFor(url: string) {
  let sent: unknown;
  globalThis.fetch = (async (_: string, init: RequestInit) => {
    sent = JSON.parse(String(init.body));
    return new Response(null, { status: 200 });
  }) as typeof fetch;
  await sendWebhook(url, "comment", "New comment on Tidepool 2.4", "https://afw.example/#inbox");
  return sent;
}

test("Telegram gets a sendMessage text with the inbox link", async () => {
  const body = await bodyFor("https://api.telegram.org/bot123:abc/sendMessage?chat_id=42");
  assert.deepEqual(body, { text: "New comment on Tidepool 2.4\nhttps://afw.example/#inbox" });
});

test("any other webhook gets the full event as JSON", async () => {
  const body = await bodyFor("https://hooks.example.com/changelark");
  assert.deepEqual(body, { event: "comment", text: "New comment on Tidepool 2.4", url: "https://afw.example/#inbox" });
});
