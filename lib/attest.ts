// Apple App Attest verification, following "Validating apps that connect to your server" step by step. Server only.
import { X509Certificate, createHash, createPublicKey, verify } from "node:crypto";
import { readFileSync } from "node:fs";
import { decodeCbor, type Cbor } from "./cbor";

// Apple App Attestation Root CA (https://www.apple.com/certificateauthority/Apple_App_Attestation_Root_CA.pem),
// SHA-256 1C:B9:82:3B:A2:8B:A6:AD:2D:33:A0:06:94:1D:E2:AE:4F:51:3E:F1:D4:E8:31:B9:F7:E0:FA:7B:62:42:C9:32. Valid until 2045.
const APPLE_ROOT = `-----BEGIN CERTIFICATE-----
MIICITCCAaegAwIBAgIQC/O+DvHN0uD7jG5yH2IXmDAKBggqhkjOPQQDAzBSMSYw
JAYDVQQDDB1BcHBsZSBBcHAgQXR0ZXN0YXRpb24gUm9vdCBDQTETMBEGA1UECgwK
QXBwbGUgSW5jLjETMBEGA1UECAwKQ2FsaWZvcm5pYTAeFw0yMDAzMTgxODMyNTNa
Fw00NTAzMTUwMDAwMDBaMFIxJjAkBgNVBAMMHUFwcGxlIEFwcCBBdHRlc3RhdGlv
biBSb290IENBMRMwEQYDVQQKDApBcHBsZSBJbmMuMRMwEQYDVQQIDApDYWxpZm9y
bmlhMHYwEAYHKoZIzj0CAQYFK4EEACIDYgAERTHhmLW07ATaFQIEVwTtT4dyctdh
NbJhFs/Ii2FdCgAHGbpphY3+d8qjuDngIN3WVhQUBHAoMeQ/cLiP1sOUtgjqK9au
Yen1mMEvRq9Sk3Jm5X8U62H+xTD3FE9TgS41o0IwQDAPBgNVHRMBAf8EBTADAQH/
MB0GA1UdDgQWBBSskRBTM72+aEH/pwyp5frq5eWKoTAOBgNVHQ8BAf8EBAMCAQYw
CgYIKoZIzj0EAwMDaAAwZQIwQgFGnByvsiVbpTKwSga0kP0e8EeDS4+sQmTvb7vn
53O5+FRXgeLhpJ06ysC5PrOyAjEAp5U4xDgEgllF7En3VcE3iexZZtKeYnpqtijV
oyFraWVIyd/dganmrduC1bmTBGwD
-----END CERTIFICATE-----`;

// Tests can point this at their own root (a path or PEM text). Never set it in production.
function rootCert() {
  const o = process.env.APP_ATTEST_ROOT_PEM;
  const pem = !o ? APPLE_ROOT : o.includes("BEGIN CERTIFICATE") ? o : readFileSync(o, "utf8");
  return new X509Certificate(pem);
}

export class ProofError extends Error {}
const fail = (why: string): never => { throw new ProofError(why); };
const sha256 = (...parts: Buffer[]) => createHash("sha256").update(Buffer.concat(parts)).digest();

const AAGUID = { production: Buffer.concat([Buffer.from("appattest"), Buffer.alloc(7)]), development: Buffer.from("appattestdevelop") };
const NONCE_OID = Buffer.from([0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x63, 0x64, 0x08, 0x02]); // 1.2.840.113635.100.8.2

// Reads one DER element at `at`: its tag, where its content starts and ends.
function tlv(der: Buffer, at: number) {
  const tag = der[at];
  let len = der[at + 1], start = at + 2;
  if (len & 0x80) {
    const n = len & 0x7f;
    if (n < 1 || n > 4) fail("bad certificate encoding");
    len = 0;
    for (let i = 0; i < n; i++) len = len * 256 + der[start + i];
    start += n;
  }
  if (start + len > der.length) fail("bad certificate encoding");
  return { tag, start, end: start + len };
}

// The nonce Apple put in the credential certificate: Extension { OID, [critical], OCTET STRING { SEQUENCE { [1] { OCTET STRING nonce } } } }.
function certNonce(cert: X509Certificate): Buffer {
  const der = cert.raw;
  const at = der.indexOf(NONCE_OID);
  if (at < 0) fail("credential certificate has no App Attest nonce");
  let el = tlv(der, at + NONCE_OID.length);
  if (el.tag === 0x01) el = tlv(der, el.end); // critical flag
  if (el.tag !== 0x04) fail("bad nonce extension");
  const seq = tlv(der, el.start);
  if (seq.tag !== 0x30) fail("bad nonce extension");
  const tagged = tlv(der, seq.start);
  if (tagged.tag !== 0xa1) fail("bad nonce extension");
  const octets = tlv(der, tagged.start);
  if (octets.tag !== 0x04 || octets.end - octets.start !== 32) fail("bad nonce extension");
  return Buffer.from(der.subarray(octets.start, octets.end));
}

const field = (m: Cbor, key: string): Cbor => (m instanceof Map ? m.get(key) : undefined);
const bytes = (v: Cbor, what: string): Buffer => (Buffer.isBuffer(v) ? v : fail(`missing ${what}`));

function validNow(c: X509Certificate) {
  const now = Date.now();
  return now >= Date.parse(c.validFrom) && now <= Date.parse(c.validTo);
}

/** Verifies a one-time key attestation and returns the key's public half (PEM) to store. */
export function verifyAttestation(o: { attestation: string; challenge: string; keyId: string; appId: string; env: "production" | "development" }) {
  let obj: Cbor;
  try { obj = decodeCbor(Buffer.from(o.attestation, "base64")); } catch { return fail("attestation is not valid CBOR"); }
  if (field(obj, "fmt") !== "apple-appattest") fail("not an App Attest attestation");
  const stmt = field(obj, "attStmt");
  const x5c = field(stmt, "x5c");
  if (!Array.isArray(x5c) || x5c.length < 2) fail("attestation has no certificate chain");
  const [leaf, intermediate] = (x5c as Cbor[]).slice(0, 2).map((c) => new X509Certificate(bytes(c, "certificate")));
  const root = rootCert();

  // 1. The chain leads to Apple's App Attest root and every certificate is in date.
  if (!intermediate.checkIssued(root) || !intermediate.verify(root.publicKey)) fail("certificate chain doesn't lead to Apple");
  if (!leaf.checkIssued(intermediate) || !leaf.verify(intermediate.publicKey)) fail("certificate chain is broken");
  if (![leaf, intermediate, root].every(validNow)) fail("a certificate has expired");

  // 2–4. nonce = SHA256(authData ‖ SHA256(challenge)) must equal the nonce in the credential certificate.
  const authData = bytes(field(obj, "authData"), "authData");
  if (!sha256(authData, sha256(Buffer.from(o.challenge))).equals(certNonce(leaf))) fail("attestation is for a different challenge");

  // 5. The key ID is the SHA256 of the credential's public key.
  const spki = leaf.publicKey.export({ type: "spki", format: "der" });
  const point = spki.subarray(spki.length - 65);
  if (!sha256(point).equals(Buffer.from(o.keyId, "base64"))) fail("key ID doesn't match the attested key");

  // 6–9. Authenticator data: our App ID, a fresh key, the right environment, the same credential.
  if (authData.length < 55) fail("authenticator data too short");
  if (!authData.subarray(0, 32).equals(sha256(Buffer.from(o.appId)))) fail("attestation is for a different app");
  if (authData.readUInt32BE(33) !== 0) fail("attested key was already used");
  if (!authData.subarray(37, 53).equals(AAGUID[o.env])) fail(`attestation is not from the ${o.env} environment`);
  const credLen = authData.readUInt16BE(53);
  if (!authData.subarray(55, 55 + credLen).equals(Buffer.from(o.keyId, "base64"))) fail("credential ID doesn't match the key ID");

  return leaf.publicKey.export({ type: "spki", format: "pem" }).toString();
}

/** Verifies a per-request assertion and returns the new counter to store. */
export function verifyAssertion(o: { assertion: string; challenge: string; publicKey: string; appId: string; counter: number }) {
  let obj: Cbor;
  try { obj = decodeCbor(Buffer.from(o.assertion, "base64")); } catch { return fail("assertion is not valid CBOR"); }
  const signature = bytes(field(obj, "signature"), "signature");
  const authData = bytes(field(obj, "authenticatorData"), "authenticatorData");
  if (authData.length < 37) fail("authenticator data too short");
  // 1–3. The signature covers SHA256(authenticatorData ‖ SHA256(challenge)).
  const nonce = sha256(authData, sha256(Buffer.from(o.challenge)));
  if (!verify("sha256", nonce, createPublicKey(o.publicKey), signature)) fail("assertion signature is invalid");
  // 4. Our App ID.
  if (!authData.subarray(0, 32).equals(sha256(Buffer.from(o.appId)))) fail("assertion is for a different app");
  // 5. The counter only goes up, so a captured assertion can't be replayed.
  const counter = authData.readUInt32BE(33);
  if (counter <= o.counter) fail("assertion was replayed");
  return counter;
}
