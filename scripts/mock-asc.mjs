// A pretend App Store Connect API for the checks. It verifies tokens the way Apple does
// (ES256 signature with the key's public half, kid, iss, aud, at most 20 minutes) and serves editable fixtures.
import http from "node:http";
import { generateKeyPairSync, verify } from "node:crypto";

export function startMockAsc(port = 4010) {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const key = {
    issuerId: "69a6de7f-3b2a-47e3-e053-5b8c7c11a4d1",
    keyId: "2X9R4HXF34",
    privateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString().trim(),
  };
  const apps = [
    { id: "1460000001", name: "Shoreline Planner", bundleId: "com.example.planner" },
    { id: "1460000002", name: "Other App", bundleId: "com.example.other" },
  ];
  // versions per app: { id, versionString, appVersionState, createdDate, whatsNew: { locale: text } }
  const versions = {
    "1460000001": [
      { id: "v20", versionString: "2.0", appVersionState: "REPLACED_WITH_NEW_VERSION", createdDate: "2026-08-01T10:00:00Z", whatsNew: { "en-US": "Widgets for the lock screen." } },
      { id: "v21", versionString: "2.1", appVersionState: "READY_FOR_DISTRIBUTION", createdDate: "2026-09-15T10:00:00Z", whatsNew: { "de-DE": "Schnellere Synchronisierung.", "en-US": "Faster sync on large lists." } },
      // A first version has no What's New; an English entry can be empty while another language has text.
      { id: "v10", versionString: "1.0", appVersionState: "REPLACED_WITH_NEW_VERSION", createdDate: "2026-05-01T10:00:00Z", whatsNew: { "en-US": null } },
      { id: "v15", versionString: "1.5", appVersionState: "REPLACED_WITH_NEW_VERSION", createdDate: "2026-06-01T10:00:00Z", whatsNew: { "en-US": "", it: "Ricerca più veloce." } },
      { id: "v19", versionString: "1.9", appVersionState: "REJECTED", createdDate: "2026-07-01T10:00:00Z", whatsNew: { "en-US": "Rejected build." } },
      { id: "v22", versionString: "2.2", appVersionState: "WAITING_FOR_REVIEW", createdDate: "2026-10-20T10:00:00Z", whatsNew: { "en-US": "Dark mode for widgets." } },
    ],
    "1460000002": [],
  };
  const requests = [];

  function authorized(header) {
    const token = (header || "").replace(/^Bearer /, "");
    const [h, b, s] = token.split(".");
    if (!s) return false;
    try {
      const head = JSON.parse(Buffer.from(h, "base64url"));
      const body = JSON.parse(Buffer.from(b, "base64url"));
      const now = Math.floor(Date.now() / 1000);
      const sigOk = verify("sha256", Buffer.from(`${h}.${b}`), { key: publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(s, "base64url"));
      return sigOk && head.alg === "ES256" && head.kid === key.keyId && body.iss === key.issuerId
        && body.aud === "appstoreconnect-v1" && body.exp > now && body.exp - now <= 20 * 60;
    } catch { return false; }
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    requests.push(url.pathname);
    const send = (status, body) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); };
    if (!authorized(req.headers.authorization)) return send(401, { errors: [{ status: "401", code: "NOT_AUTHORIZED" }] });
    let m;
    if (url.pathname === "/v1/apps") return send(200, { data: apps.map((a) => ({ type: "apps", id: a.id, attributes: { name: a.name, bundleId: a.bundleId } })) });
    if ((m = url.pathname.match(/^\/v1\/apps\/(\d+)\/appStoreVersions$/))) {
      if (!versions[m[1]]) return send(404, { errors: [{ status: "404" }] });
      if (url.searchParams.get("filter[platform]") !== "IOS") return send(400, { errors: [{ status: "400", detail: "expected filter[platform]=IOS" }] });
      return send(200, { data: versions[m[1]].map((v) => ({ type: "appStoreVersions", id: v.id, attributes: { versionString: v.versionString, appVersionState: v.appVersionState, createdDate: v.createdDate, earliestReleaseDate: null } })) });
    }
    if ((m = url.pathname.match(/^\/v1\/appStoreVersions\/(\w+)\/appStoreVersionLocalizations$/))) {
      const v = Object.values(versions).flat().find((x) => x.id === m[1]);
      if (!v) return send(404, { errors: [{ status: "404" }] });
      return send(200, { data: Object.entries(v.whatsNew).map(([locale, whatsNew], i) => ({ type: "appStoreVersionLocalizations", id: `${v.id}-${i}`, attributes: { locale, whatsNew } })) });
    }
    send(404, { errors: [{ status: "404" }] });
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve({ key, apps, versions, requests, close: () => server.close() }));
  });
}
