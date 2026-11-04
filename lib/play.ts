// Google Play Integrity (classic requests): decode the device's token on Google's servers and check the verdict. Server only.
import { createPrivateKey, sign } from "node:crypto";
import { ProofError } from "./attest";

const API = (process.env.PLAY_INTEGRITY_URL || "https://playintegrity.googleapis.com").replace(/\/$/, "");
const SCOPE = "https://www.googleapis.com/auth/playintegrity";
const MAX_AGE_MS = 5 * 60 * 1000;

export interface ServiceAccount { client_email: string; private_key: string; token_uri?: string }

export function parseServiceAccount(json: string): ServiceAccount {
  let sa: Partial<ServiceAccount> & { type?: string };
  try { sa = JSON.parse(json); } catch { throw new ProofError("That isn't a JSON key file."); }
  if (sa.type !== "service_account" || !sa.client_email || !sa.private_key?.includes("BEGIN PRIVATE KEY")) {
    throw new ProofError("Use a service account JSON key (it has type, client_email and private_key).");
  }
  return { client_email: sa.client_email, private_key: sa.private_key, token_uri: sa.token_uri };
}

// ponytail: in-memory token cache per server instance; tokens last an hour, so a cold start just fetches a new one.
const tokens = new Map<string, { token: string; until: number }>();

async function accessToken(sa: ServiceAccount) {
  const cached = tokens.get(sa.client_email);
  if (cached && cached.until > Date.now() + 60_000) return cached.token;
  const tokenUri = sa.token_uri || "https://oauth2.googleapis.com/token";
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({ iss: sa.client_email, scope: SCOPE, aud: tokenUri, iat: now, exp: now + 3600 })}`;
  const assertion = `${unsigned}.${sign("sha256", Buffer.from(unsigned), createPrivateKey(sa.private_key)).toString("base64url")}`;
  const res = await fetch(tokenUri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
    cache: "no-store",
  });
  if (!res.ok) throw new ProofError("Google refused the service account. Check the JSON key and that it belongs to the project linked in Play Console.");
  const { access_token, expires_in } = await res.json();
  tokens.set(sa.client_email, { token: access_token, until: Date.now() + (expires_in || 3600) * 1000 });
  return access_token as string;
}

/** Asks Google for an access token, so a bad or disabled key is caught before it's stored. */
export async function checkServiceAccount(sa: ServiceAccount) {
  tokens.delete(sa.client_email);
  await accessToken(sa);
}

/** Checks a token proves this request comes from a genuine, Play-installed copy of the app on a real device. */
export async function verifyPlayToken(o: { token: string; challenge: string; packageName: string; account: ServiceAccount }) {
  const res = await fetch(`${API}/v1/${encodeURIComponent(o.packageName)}:decodeIntegrityToken`, {
    method: "POST",
    headers: { Authorization: `Bearer ${await accessToken(o.account)}`, "Content-Type": "application/json" },
    body: JSON.stringify({ integrity_token: o.token }),
    cache: "no-store",
  });
  if (!res.ok) throw new ProofError(res.status === 403 ? "The service account can't read this app's integrity tokens." : "Google couldn't decode the integrity token.");
  const v = (await res.json()).tokenPayloadExternal || {};
  const req = v.requestDetails || {};
  if (req.requestPackageName !== o.packageName) throw new ProofError("integrity token is for a different app");
  if (req.nonce !== o.challenge) throw new ProofError("integrity token is for a different challenge");
  if (!(Date.now() - Number(req.timestampMillis) <= MAX_AGE_MS)) throw new ProofError("integrity token is too old");
  if (v.appIntegrity?.appRecognitionVerdict !== "PLAY_RECOGNIZED") throw new ProofError("the app isn't the version from Google Play");
  if (!(v.deviceIntegrity?.deviceRecognitionVerdict || []).includes("MEETS_DEVICE_INTEGRITY")) throw new ProofError("the device didn't pass integrity checks");
}
