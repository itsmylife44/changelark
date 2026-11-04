// Run: node --test scripts/backup.test.mjs (runs cron/backup.sh with a fake pg_dump).
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// A source tree like the cron container's /backup: db-config and storage volumes, and .env.
const fakeDump = 'while [ $# -gt 0 ]; do [ "$1" = -f ] && out=$2; shift; done; echo "dump of $PGDATABASE as $PGUSER" > "$out"';
function fixture(pgDump = fakeDump) {
  const root = mkdtempSync(join(tmpdir(), "afw-backup-"));
  const src = join(root, "src"), dest = join(root, "backups"), bin = join(root, "bin");
  mkdirSync(join(src, "db-config"), { recursive: true });
  mkdirSync(join(src, "storage/stub/stub/screenshots/app1"), { recursive: true });
  mkdirSync(dest); mkdirSync(bin);
  writeFileSync(join(src, "db-config/pgsodium_root.key"), "key");
  writeFileSync(join(src, "storage/stub/stub/screenshots/app1/r1.png"), "png");
  writeFileSync(join(src, ".env"), "DUMMY=1\n");
  writeFileSync(join(bin, "pg_dump"), `#!/bin/sh\n${pgDump}\n`);
  chmodSync(join(bin, "pg_dump"), 0o755);
  return { src, dest, bin };
}
const backup = ({ src, dest, bin }, env = { POSTGRES_PASSWORD: "pw" }) =>
  spawnSync("sh", ["cron/backup.sh"], { env: { PATH: `${bin}:${process.env.PATH}`, BACKUP_SRC: src, BACKUP_DIR: dest, ...env }, encoding: "utf8" });
const archives = (dest) => readdirSync(dest).filter((f) => /^changelark-.*\.tar\.gz$/.test(f)).sort();

test("writes one archive with the database dump, db-config, storage and .env", () => {
  const f = fixture();
  const run = backup(f);
  assert.equal(run.status, 0, run.stderr + run.stdout);
  const [name] = archives(f.dest);
  assert.ok(name, "no archive written");
  const list = execFileSync("tar", ["-tzf", join(f.dest, name)], { encoding: "utf8" }).split("\n");
  for (const part of ["db.dump", "db-config/pgsodium_root.key", "storage/stub/stub/screenshots/app1/r1.png", ".env"])
    assert.ok(list.some((l) => l.replace(/^\.\//, "") === part), `${part} missing from ${list.join(", ")}`);
  assert.equal(execFileSync("tar", ["-xzOf", join(f.dest, name), "db.dump"], { encoding: "utf8" }), "dump of postgres as supabase_admin\n");
});

test("keeps only the newest 7 archives", () => {
  const f = fixture();
  const old = Array.from({ length: 8 }, (_, i) => `changelark-2026010${i}T030000Z.tar.gz`);
  for (const n of old) writeFileSync(join(f.dest, n), "");
  assert.equal(backup(f).status, 0);
  const left = archives(f.dest);
  assert.equal(left.length, 7);
  assert.deepEqual(left.slice(0, 6), old.slice(2), "the two oldest should be gone");
  assert.ok(!left.at(-1).startsWith("changelark-202601"), "the new archive should be kept");
});

test("a failed dump writes no archive and exits non-zero", () => {
  const f = fixture('echo "connection refused" >&2; exit 1');
  const run = backup(f);
  assert.notEqual(run.status, 0);
  assert.match(run.stdout, /FAILED: pg_dump: connection refused/);
  assert.deepEqual(readdirSync(f.dest), []);
});

test("skips without POSTGRES_PASSWORD (Supabase Cloud has its own backups)", () => {
  const f = fixture();
  const run = backup(f, {});
  assert.equal(run.status, 0);
  assert.match(run.stdout, /backup skipped/);
  assert.deepEqual(readdirSync(f.dest), []);
});
