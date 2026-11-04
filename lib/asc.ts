// App Store Connect: sign API tokens with the developer's key and import versions as releases. Server only.
import { createPrivateKey, sign } from "node:crypto";
import { admin, type Db } from "./server";

const API = (process.env.ASC_API_URL || "https://api.appstoreconnect.apple.com").replace(/\/$/, "");

export interface AscKey { issuerId: string; keyId: string; privateKey: string }
export interface AscApp { id: string; name: string; bundleId: string }
export interface SyncResult { imported: number; published: number }

// Versions that are (or were) on the App Store become published releases.
const LIVE = new Set(["READY_FOR_DISTRIBUTION", "REPLACED_WITH_NEW_VERSION"]);
// Versions on their way there become drafts, published automatically once they go live.
const PENDING = new Set([
  "PREPARE_FOR_SUBMISSION", "READY_FOR_REVIEW", "WAITING_FOR_REVIEW", "IN_REVIEW", "WAITING_FOR_EXPORT_COMPLIANCE",
  "ACCEPTED", "PENDING_DEVELOPER_RELEASE", "PENDING_APPLE_RELEASE", "PROCESSING_FOR_DISTRIBUTION",
]);
// Rejected or invalid versions are skipped until they move to one of the states above.

const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64url");

// ES256 JWT as Apple requires: kid header, issuer, audience, at most 20 minutes of validity.
export function ascToken({ issuerId, keyId, privateKey }: AscKey, now = Math.floor(Date.now() / 1000)) {
  const head = b64url(JSON.stringify({ alg: "ES256", kid: keyId, typ: "JWT" }));
  const body = b64url(JSON.stringify({ iss: issuerId, iat: now, exp: now + 15 * 60, aud: "appstoreconnect-v1" }));
  const sig = sign("sha256", Buffer.from(`${head}.${body}`), { key: createPrivateKey(privateKey), dsaEncoding: "ieee-p1363" });
  return `${head}.${body}.${b64url(sig)}`;
}

export class AscError extends Error {}

async function get<T>(key: AscKey, path: string): Promise<T> {
  const res = await fetch(API + path, { headers: { Authorization: `Bearer ${ascToken(key)}` }, cache: "no-store" });
  if (res.ok) return res.json() as Promise<T>;
  const reason = res.status === 401 ? "Apple refused the key. Check the Issuer ID, the Key ID and the .p8 file."
    : res.status === 403 ? "This key can't read that app. Give it the App Manager, Developer or Admin role."
    : res.status === 404 ? "App Store Connect couldn't find that app."
    : res.status === 429 ? "App Store Connect is rate limiting requests. Try again in a few minutes."
    : `App Store Connect answered ${res.status}.`;
  throw new AscError(reason);
}

type List<A> = { data: { id: string; attributes: A }[] };

export async function listAscApps(key: AscKey): Promise<AscApp[]> {
  const r = await get<List<{ name: string; bundleId: string }>>(key, "/v1/apps?fields[apps]=name,bundleId&limit=200");
  return r.data.map((a) => ({ id: a.id, name: a.attributes.name, bundleId: a.attributes.bundleId }));
}

// English becomes the main notes; every other App Store language becomes a translation ("de-DE" → "de", "pt-BR" → "pt-br").
// An English entry with no text doesn't count, so the notes come from the first language that has some.
function splitLocales(locs: { locale: string; whatsNew: string | null }[]) {
  const written = locs.filter((x) => (x.whatsNew || "").trim());
  const by = (l: string) => written.find((x) => x.locale === l);
  const main = by("en-US") || by("en-GB") || written.find((x) => x.locale.startsWith("en")) || written[0];
  const translations: Record<string, string> = {};
  for (const l of locs) {
    const text = (l.whatsNew || "").trim();
    if (l === main || !text || (main?.locale.startsWith("en") && l.locale.startsWith("en"))) continue;
    const [lang, region] = l.locale.toLowerCase().split("-");
    const code = locs.filter((x) => x.locale.toLowerCase().startsWith(lang + "-")).length > 1 && region ? `${lang}-${region}` : lang;
    translations[code] = text;
  }
  return { notes: (main?.whatsNew || "").trim(), translations };
}

// Imports new iOS versions of one linked app. Never edits releases written by hand.
export async function syncApp(db: Db, key: AscKey, app: { id: string; asc_app_id: string }): Promise<SyncResult> {
  type V = { versionString: string; appVersionState: string; createdDate: string; earliestReleaseDate: string | null };
  const versions = (await get<List<V>>(key,
    `/v1/apps/${encodeURIComponent(app.asc_app_id)}/appStoreVersions?filter[platform]=IOS&fields[appStoreVersions]=versionString,appVersionState,createdDate,earliestReleaseDate&limit=50`,
  )).data.sort((a, b) => a.attributes.createdDate.localeCompare(b.attributes.createdDate));

  const { data: existing, error } = await db.from("releases").select("id, version, published, source, notes").eq("app_id", app.id);
  if (error) throw error;
  const have = new Map(existing.map((r) => [r.version, r]));
  const result: SyncResult = { imported: 0, published: 0 };

  for (const v of versions) {
    const { versionString, appVersionState: state, createdDate, earliestReleaseDate } = v.attributes;
    const live = LIVE.has(state);
    if ((!live && !PENDING.has(state)) || !/^\d+(\.\d+){0,3}$/.test(versionString)) continue;
    const ex = have.get(versionString);
    if (ex && (ex.source !== "app_store" || ex.published || !live)) continue;

    const locs = await get<List<{ locale: string; whatsNew: string | null }>>(key,
      `/v1/appStoreVersions/${encodeURIComponent(v.id)}/appStoreVersionLocalizations?fields[appStoreVersionLocalizations]=locale,whatsNew&limit=50`);
    const { notes, translations } = splitLocales(locs.data.map((l) => l.attributes));

    // No text in any language (Apple allows none on a first version): a draft, never an empty public entry.
    const hasText = !!(notes || ex?.notes);
    if (ex) {
      // An imported draft that just went live: publish it, keeping notes the developer may have edited.
      // ponytail: a live version that never gets text is re-checked on every sync; one extra request each time.
      if (!hasText) continue;
      const { error: e } = await db.from("releases").update({ published: true, notes: ex.notes || notes, release_date: today(), ...(ex.notes ? {} : { translations }) }).eq("id", ex.id);
      if (e) throw e;
      result.published++;
    } else {
      const date = (live ? createdDate : earliestReleaseDate || createdDate).slice(0, 10);
      const { error: e } = await db.from("releases").insert({ app_id: app.id, version: versionString, notes, translations, published: live && hasText, release_date: date, source: "app_store" });
      if (e) throw e;
      result.imported++;
    }
  }
  await db.from("apps").update({ synced_at: new Date().toISOString() }).eq("id", app.id);
  return result;
}

const today = () => new Date().toISOString().slice(0, 10);

export async function keyFor(owner: string): Promise<AscKey | null> {
  const db = admin();
  const [{ data: conn }, { data: pem }] = await Promise.all([
    db.from("asc_connections").select("issuer_id, key_id").eq("owner_id", owner).maybeSingle(),
    db.rpc("asc_private_key", { p_owner: owner }),
  ]);
  return conn && pem ? { issuerId: conn.issuer_id, keyId: conn.key_id, privateKey: pem } : null;
}

// Syncs every linked app of one developer and records the outcome on their connection.
export async function syncOwner(owner: string, onlyAppId?: string): Promise<SyncResult> {
  const db = admin();
  const key = await keyFor(owner);
  if (!key) throw new AscError("Connect App Store Connect in Account first.");
  let q = db.from("apps").select("id, asc_app_id").eq("owner_id", owner).not("asc_app_id", "is", null);
  if (onlyAppId) q = q.eq("id", onlyAppId);
  const { data: apps, error } = await q;
  if (error) throw error;
  const total: SyncResult = { imported: 0, published: 0 };
  try {
    for (const a of apps) {
      const r = await syncApp(db, key, { id: a.id, asc_app_id: a.asc_app_id! });
      total.imported += r.imported;
      total.published += r.published;
    }
    await db.from("asc_connections").update({ last_sync_at: new Date().toISOString(), last_error: null }).eq("owner_id", owner);
    return total;
  } catch (e) {
    await db.from("asc_connections").update({ last_error: (e as Error).message }).eq("owner_id", owner);
    throw e;
  }
}
