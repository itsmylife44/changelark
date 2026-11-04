// Run: node --test lib/busy.test.ts
import { registerHooks } from "node:module";
import { test } from "node:test";
import assert from "node:assert/strict";

// Next.js imports have no extension; teach Node to try ".ts".
registerHooks({
  resolve(s, c, next) {
    try { return next(s, c); } catch (e) { if (s.startsWith(".")) return next(s + ".ts", c); throw e; }
  },
});
const { withBusy, NETWORK_ERROR } = await import("./busy");

function busyLog() {
  const log: boolean[] = [];
  return { log, setBusy: (b: boolean) => { log.push(b); } };
}

test("passes the action's own result through and clears busy", async () => {
  const { log, setBusy } = busyLog();
  assert.equal(await withBusy(setBusy, async () => "Your current password isn't right."), "Your current password isn't right.");
  assert.equal(await withBusy(setBusy, async () => null), null);
  assert.deepEqual(log, [true, false, true, false]);
});

test("a thrown action shows the network error and clears busy", async () => {
  const { log, setBusy } = busyLog();
  assert.equal(await withBusy(setBusy, async () => { throw new TypeError("Failed to fetch"); }), NETWORK_ERROR);
  assert.equal(NETWORK_ERROR, "Something went wrong. Check your connection and try again.");
  assert.deepEqual(log, [true, false]);
});
