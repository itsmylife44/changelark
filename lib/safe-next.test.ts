// Run: node --test lib/safe-next.test.ts
import { registerHooks } from "node:module";
import { test } from "node:test";
import assert from "node:assert/strict";

// Next.js imports have no extension; teach Node to try ".ts".
registerHooks({
  resolve(s, c, next) {
    try { return next(s, c); } catch (e) { if (s.startsWith(".")) return next(s + ".ts", c); throw e; }
  },
});
const { safeNext } = await import("./safe-next");

test("keeps same-site paths", () => {
  for (const p of ["/", "/settings", "/a?b=1#c", "/login?error=link"]) assert.equal(safeNext(p), p, p);
});

test("falls back to / for anything that could leave the site", () => {
  const bad = [
    null, "", "//evil.com", "/\\evil.com", "/\\/evil.com", "https://evil.com", "javascript:alert(1)",
    " /settings", "\t/settings", "/set\ntings", "/set\x00tings", "settings",
  ];
  for (const v of bad) assert.equal(safeNext(v), "/", JSON.stringify(v));
});
