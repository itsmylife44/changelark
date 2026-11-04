// App proofs end to end: the real SDK client against the server, with cryptographically real App Attest objects
// (from a test certificate chain) and a pretend Google that issues OAuth tokens and Play Integrity verdicts.
// Start the app with:
//   APP_ATTEST_ROOT_PEM=scripts/.attest-test-root.pem PLAY_INTEGRITY_URL=http://127.0.0.1:4011 npm start
// then: node scripts/check-proofs.mjs [http://127.0.0.1:3000]   (needs SUPABASE_SECRET_KEY, or .env.local)
import assert from "node:assert/strict";
import http from "node:http";
import { createHash, generateKeyPairSync, randomBytes, sign, verify } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { createClient as supabaseClient } from "@supabase/supabase-js";

try { process.loadEnvFile(".env.local"); } catch {}
const BASE = process.argv[2] || "http://127.0.0.1:3000";
const here = dirname(fileURLToPath(import.meta.url));
const { createClient } = createRequire(import.meta.url)("../sdk/react-native/src/client.js");
const db = supabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:54321", process.env.SUPABASE_SECRET_KEY);
const step = (name) => console.log("✓", name);
const sha256 = (...b) => createHash("sha256").update(Buffer.concat(b)).digest();
const IOS_APP_ID = "ABCDE12345.com.example.proofs";
const PACKAGE = "com.example.proofs";

// ---------- a tiny CBOR encoder (the server has the decoder) ----------
function cbor(v) {
  const head = (major, n) => n < 24 ? Buffer.from([major << 5 | n]) : n < 256 ? Buffer.from([major << 5 | 24, n]) : n < 65536 ? Buffer.from([major << 5 | 25, n >> 8, n & 255]) : Buffer.concat([Buffer.from([major << 5 | 26]), Buffer.from([n >>> 24, n >> 16 & 255, n >> 8 & 255, n & 255])]);
  if (Buffer.isBuffer(v)) return Buffer.concat([head(2, v.length), v]);
  if (typeof v === "string") { const b = Buffer.from(v); return Buffer.concat([head(3, b.length), b]); }
  if (Array.isArray(v)) return Buffer.concat([head(4, v.length), ...v.map(cbor)]);
  const entries = Object.entries(v);
  return Buffer.concat([head(5, entries.length), ...entries.flatMap(([k, x]) => [cbor(k), cbor(x)])]);
}

// ---------- a test App Attest certificate chain, built with openssl ----------
const dir = mkdtempSync(join(tmpdir(), "changelark-attest-"));
const ossl = (...args) => execFileSync("openssl", args, { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
ossl("req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:P-384", "-nodes", "-keyout", "root.key", "-out", "root.pem", "-days", "2", "-subj", "/CN=Test App Attestation Root CA",
  "-addext", "basicConstraints=critical,CA:TRUE", "-addext", "keyUsage=critical,keyCertSign");
ossl("req", "-new", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:P-384", "-nodes", "-keyout", "int.key", "-out", "int.csr", "-subj", "/CN=Test App Attestation CA 1");
writeFileSync(join(dir, "ca.cnf"), "basicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign\n");
ossl("x509", "-req", "-in", "int.csr", "-CA", "root.pem", "-CAkey", "root.key", "-set_serial", "2", "-days", "2", "-extfile", "ca.cnf", "-out", "int.pem");
const rootPath = join(here, ".attest-test-root.pem");
writeFileSync(rootPath, readFileSync(join(dir, "root.pem"))); // the server reads this through APP_ATTEST_ROOT_PEM
const intDer = Buffer.from(ossl("x509", "-in", "int.pem", "-outform", "DER"));
// A look-alike CA that the server doesn't trust: same names, different keys.
ossl("req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:P-384", "-nodes", "-keyout", "rogue-root.key", "-out", "rogue-root.pem", "-days", "2", "-subj", "/CN=Test App Attestation Root CA",
  "-addext", "basicConstraints=critical,CA:TRUE", "-addext", "keyUsage=critical,keyCertSign");
ossl("req", "-new", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:P-384", "-nodes", "-keyout", "rogue-int.key", "-out", "rogue-int.csr", "-subj", "/CN=Test App Attestation CA 1");
ossl("x509", "-req", "-in", "rogue-int.csr", "-CA", "rogue-root.pem", "-CAkey", "rogue-root.key", "-set_serial", "3", "-days", "2", "-extfile", "ca.cnf", "-out", "rogue-int.pem");
const rogueIntDer = Buffer.from(ossl("x509", "-in", "rogue-int.pem", "-outform", "DER"));

// A device: one App Attest key, a counter, and an attestation made for a given challenge.
function makeDevice(appId = IOS_APP_ID, { rogue = false } = {}) {
  const ca = rogue ? { pem: "rogue-int.pem", key: "rogue-int.key", der: rogueIntDer } : { pem: "int.pem", key: "int.key", der: intDer };
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const spki = publicKey.export({ type: "spki", format: "der" });
  const point = spki.subarray(spki.length - 65);
  const keyId = sha256(point).toString("base64");
  let counter = 0;
  const n = randomBytes(4).toString("hex");
  writeFileSync(join(dir, `leaf-${n}.key`), privateKey.export({ type: "pkcs8", format: "pem" }));
  return {
    keyId,
    anonId: "proofdevice" + randomBytes(10).toString("hex"),
    attest(challenge) {
      const authData = Buffer.concat([sha256(Buffer.from(appId)), Buffer.from([0x40]), Buffer.alloc(4), Buffer.from("appattestdevelop"), Buffer.from([0, 32]), sha256(point), Buffer.from([0xa5])]);
      const nonce = sha256(authData, sha256(Buffer.from(challenge)));
      ossl("req", "-new", "-key", `leaf-${n}.key`, "-out", `leaf-${n}.csr`, "-subj", `/CN=App Attest key ${n}`);
      writeFileSync(join(dir, `leaf-${n}.cnf`), `1.2.840.113635.100.8.2=DER:3024a1220420${nonce.toString("hex")}\n`);
      ossl("x509", "-req", "-in", `leaf-${n}.csr`, "-CA", ca.pem, "-CAkey", ca.key, "-set_serial", String(Date.now()), "-days", "1", "-extfile", `leaf-${n}.cnf`, "-out", `leaf-${n}.pem`);
      const leafDer = Buffer.from(ossl("x509", "-in", `leaf-${n}.pem`, "-outform", "DER"));
      return cbor({ fmt: "apple-appattest", attStmt: { x5c: [leafDer, ca.der], receipt: Buffer.from("receipt") }, authData }).toString("base64");
    },
    assert(challenge, { counterOverride } = {}) {
      counter = counterOverride ?? counter + 1;
      const authData = Buffer.concat([sha256(Buffer.from(appId)), Buffer.from([0x40]), Buffer.from([counter >>> 24, counter >> 16 & 255, counter >> 8 & 255, counter & 255])]);
      const signature = sign("sha256", sha256(authData, sha256(Buffer.from(challenge))), privateKey);
      return cbor({ signature, authenticatorData: authData }).toString("base64");
    },
  };
}

// ---------- a pretend Google: OAuth tokens for a service account, and Play Integrity verdicts ----------
const google = generateKeyPairSync("rsa", { modulusLength: 2048 });
const SA = { type: "service_account", client_email: "changelark-check@example.iam.gserviceaccount.com", private_key: google.privateKey.export({ type: "pkcs8", format: "pem" }), token_uri: "http://127.0.0.1:4011/token" };
const playToken = (verdict) => Buffer.from(JSON.stringify(verdict)).toString("base64url"); // the mock "encrypts" by base64
const mock = http.createServer(async (req, res) => {
  let raw = ""; for await (const c of req) raw += c;
  const send = (s, b) => { res.writeHead(s, { "Content-Type": "application/json" }); res.end(JSON.stringify(b)); };
  if (req.url === "/token") {
    const jwt = new URLSearchParams(raw).get("assertion") || "";
    const [h, b, s] = jwt.split(".");
    const claims = JSON.parse(Buffer.from(b || "", "base64url").toString() || "{}");
    const ok = s && verify("sha256", Buffer.from(`${h}.${b}`), google.publicKey, Buffer.from(s, "base64url"))
      && claims.iss === SA.client_email && claims.scope === "https://www.googleapis.com/auth/playintegrity" && claims.aud === SA.token_uri;
    return ok ? send(200, { access_token: "ya29.test", expires_in: 3600 }) : send(400, { error: "invalid_grant" });
  }
  const m = req.url.match(/^\/v1\/([^:]+):decodeIntegrityToken$/);
  if (m && req.headers.authorization === "Bearer ya29.test") {
    const { integrity_token } = JSON.parse(raw);
    return send(200, { tokenPayloadExternal: JSON.parse(Buffer.from(integrity_token, "base64url").toString()) });
  }
  send(401, { error: "unauthorized" });
}).listen(4011, "127.0.0.1");

// ---------- an app that requires proofs ----------
const email = `proofs-${Date.now()}@example.com`;
const { data: made, error: e1 } = await db.auth.admin.createUser({ email, password: "proofs-pass-123", email_confirm: true });
assert.ifError(e1);
const owner = made.user.id;
const key = "clk_" + randomBytes(10).toString("hex");
const { data: app, error: e2 } = await db.from("apps").insert({
  owner_id: owner, slug: "proofs-" + randomBytes(3).toString("hex"), name: "Proofs", key,
  proof_mode: "required", ios_app_id: IOS_APP_ID, ios_attest_env: "development", android_package: PACKAGE,
}).select("id").single();
assert.ifError(e2);
await db.from("releases").insert({ app_id: app.id, version: "1.0", notes: "First.", published: true, release_date: "2026-01-01" });
assert.ifError((await db.rpc("play_save_key", { p_owner: owner, p_client_email: SA.client_email, p_json: JSON.stringify(SA) })).error);

const client = (device, getAppProof) => createClient({ baseUrl: BASE, appKey: key, anonId: device.anonId, appVersion: "1.0", getAppProof });
const apple = (device) => async (challenge, { attest }) => attest ? { kind: "apple", keyId: device.keyId, attestation: device.attest(challenge) } : { kind: "apple", keyId: device.keyId, assertion: device.assert(challenge) };
const rejects = async (p, code) => { try { await p; } catch (e) { assert.equal(e.code, code); return; } assert.fail(`expected ${code}`); };

try {
  // Without a proof: reads work, writes don't.
  const plain = makeDevice();
  const noProof = client(plain);
  assert.equal((await noProof.config()).app.proofRequired, true);
  assert.equal((await noProof.releases()).items.length, 1);
  await rejects(noProof.acceptGuidelines(), "proof_required");
  step("proofs required: reads work, writes without a proof are refused");

  // iOS: first write registers the key (attestation), then assertions with a rising counter.
  const phone = makeDevice();
  const ios = client(phone, apple(phone));
  await ios.acceptGuidelines();
  const posted = await ios.addComment("1.0", "From a genuine iPhone");
  assert.ok(posted.id);
  const rel = (await ios.releases()).items[0];
  assert.equal((await ios.vote("release", rel.id, 1)).myVote, 1);
  const { data: keyRow } = await db.from("attest_keys").select("counter").eq("app_id", app.id).eq("key_id", phone.keyId).single();
  assert.equal(keyRow.counter, 4); // the first assertion (1) was spent before the server asked for the attestation
  step("App Attest: key attested once, then every write carries an assertion");

  // Replays: the same challenge twice, and an old counter with a fresh challenge.
  const raw = (headers) => fetch(`${BASE}/api/v1/sdk/guidelines/accept`, { method: "POST", headers: { "Content-Type": "application/json", "X-Changelark-App-Key": key, "X-Changelark-Anon-Id": phone.anonId, ...headers }, body: "{}" });
  const challenge = async (anon = phone.anonId) => (await (await fetch(`${BASE}/api/v1/sdk/attest/challenge`, { method: "POST", headers: { "X-Changelark-App-Key": key, "X-Changelark-Anon-Id": anon }, body: "{}" })).json()).challenge;
  const c1 = await challenge();
  const h1 = { "X-Changelark-Challenge": c1, "X-Changelark-Proof-Kind": "apple", "X-Changelark-Proof-Key": phone.keyId, "X-Changelark-Proof": phone.assert(c1) };
  assert.equal((await raw(h1)).status, 200);
  assert.equal((await (await raw(h1)).json()).error.code, "challenge_invalid");
  const c2 = await challenge();
  const old = await (await raw({ "X-Changelark-Challenge": c2, "X-Changelark-Proof-Kind": "apple", "X-Changelark-Proof-Key": phone.keyId, "X-Changelark-Proof": phone.assert(c2, { counterOverride: 2 }) })).json();
  assert.equal(old.error.code, "proof_invalid");
  assert.match(old.error.message, /replayed/);
  step("App Attest: replayed challenges and old counters are refused");

  // A key belongs to the device that registered it.
  const thief = { ...makeDevice(), keyId: phone.keyId };
  const c3 = await challenge(thief.anonId);
  const stolen = await (await fetch(`${BASE}/api/v1/sdk/guidelines/accept`, { method: "POST", headers: { "X-Changelark-App-Key": key, "X-Changelark-Anon-Id": thief.anonId, "X-Changelark-Challenge": c3, "X-Changelark-Proof-Kind": "apple", "X-Changelark-Proof-Key": phone.keyId, "X-Changelark-Proof": phone.assert(c3) }, body: "{}" })).json();
  assert.equal(stolen.error.code, "attestation_required");
  step("App Attest: a key can't be used from another install");

  // Attestations for another app, or a forged signature, are refused.
  const other = makeDevice("ZZZZZ99999.com.someone.else");
  await rejects(client(other, apple(other)).acceptGuidelines(), "proof_invalid");
  const forger = makeDevice();
  const forged = client(forger, async (c, { attest }) => attest ? { keyId: forger.keyId, attestation: forger.attest(c) } : { keyId: forger.keyId, assertion: makeDevice().assert(c) });
  await rejects(forged.acceptGuidelines(), "proof_invalid");
  const rogue = makeDevice(IOS_APP_ID, { rogue: true });
  try { await client(rogue, apple(rogue)).acceptGuidelines(); assert.fail("rogue chain accepted"); }
  catch (e) { assert.equal(e.code, "proof_invalid"); assert.match(e.message, /doesn't lead to Apple/); }
  step("App Attest: wrong app, forged signatures and certificates from another CA are refused");

  // Android: Play Integrity verdicts, decoded by (pretend) Google with the developer's service account.
  const droid = makeDevice();
  const verdict = (challenge, over = {}) => ({
    requestDetails: { requestPackageName: PACKAGE, nonce: challenge, timestampMillis: String(Date.now()) },
    appIntegrity: { appRecognitionVerdict: "PLAY_RECOGNIZED", packageName: PACKAGE },
    deviceIntegrity: { deviceRecognitionVerdict: ["MEETS_DEVICE_INTEGRITY"] },
    ...over,
  });
  const android = client(droid, async (c) => ({ kind: "play", token: playToken(verdict(c)) }));
  await android.acceptGuidelines();
  assert.ok((await android.addComment("1.0", "From a genuine Android phone")).id);
  step("Play Integrity: genuine app on a genuine device can post");

  for (const [why, make] of [
    ["sideloaded app", (c) => verdict(c, { appIntegrity: { appRecognitionVerdict: "UNRECOGNIZED_VERSION" } })],
    ["emulator", (c) => verdict(c, { deviceIntegrity: { deviceRecognitionVerdict: [] } })],
    ["wrong nonce", () => verdict("x".repeat(43))],
    ["old token", (c) => verdict(c, { requestDetails: { requestPackageName: PACKAGE, nonce: c, timestampMillis: String(Date.now() - 10 * 60_000) } })],
  ]) {
    const d = makeDevice();
    await rejects(client(d, async (c) => ({ kind: "play", token: playToken(make(c)) })).acceptGuidelines(), "proof_invalid");
    void why;
  }
  step("Play Integrity: sideloaded apps, emulators, wrong nonces and old tokens are refused");

  // Turning proofs off opens writes again.
  await db.from("apps").update({ proof_mode: "off" }).eq("id", app.id);
  await client(makeDevice()).acceptGuidelines();
  step("proofs off: writes without proofs work again");

  console.log("\nAll app proof checks passed.");
} finally {
  await db.auth.admin.deleteUser(owner); // cascades the app, keys and the Vault secret
  mock.close();
}
