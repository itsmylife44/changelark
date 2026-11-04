// Talks to your Changelark server. Every call identifies the app (public key) and the anonymous installation.
//
// The app key is PUBLIC: anyone can read it out of an app bundle, like a website address.
// It only says which app's notes to load and where comments go. It can't log in, read private data
// or change anything in the dashboard. Abuse is limited on the server (rate limits, moderation, reports),
// and you can turn on app proofs so only genuine copies of your app can post.
const SDK = "react-native/0.1.0";

function checkKey(appKey) {
  if (typeof appKey !== "string" || !appKey.startsWith("clk_")) {
    throw new Error("Changelark: use the public app key (starts with clk_). Never put a secret or admin key inside an app.");
  }
}

// getAppProof (optional), from your App Attest / Play Integrity native module. Called with a fresh one-time challenge
// for every write (votes, comments, reports, blocks). Return one of:
//   { kind: "apple", keyId, assertion }      App Attest assertion over SHA256(challenge)
//   { kind: "apple", keyId, attestation }    only when called with { attest: true }: attestKey(keyId, SHA256(challenge))
//   { kind: "play", token }                  Play Integrity token requested with nonce = challenge
// The first time an Apple key is seen, the server asks for an attestation; this client handles that round trip.
function createClient({ baseUrl, appKey, anonId, appVersion, locale, getAppProof, fetchImpl = fetch }) {
  checkKey(appKey);
  const root = baseUrl.replace(/\/$/, "") + "/api/v1/sdk";
  const baseHeaders = {
    "Content-Type": "application/json",
    "X-Changelark-App-Key": appKey,
    "X-Changelark-Anon-Id": anonId,
    "X-Changelark-App-Version": appVersion,
    "X-Changelark-SDK": SDK,
  };
  if (locale) baseHeaders["X-Changelark-Locale"] = locale;

  async function send(path, { method = "GET", query, body, headers = {} } = {}) {
    const qs = query ? "?" + new URLSearchParams(Object.entries(query).filter(([, v]) => v != null)).toString() : "";
    const res = await fetchImpl(root + path + qs, { method, headers: { ...baseHeaders, ...headers }, body: body ? JSON.stringify(body) : undefined });
    const data = await res.json().catch(() => ({}));
    return { res, data };
  }

  function fail({ res, data }) {
    const err = new Error(data?.error?.message || `Request failed (${res.status})`);
    err.code = data?.error?.code || String(res.status);
    throw err;
  }

  async function challenge() {
    const r = await send("/attest/challenge", { method: "POST", body: {} });
    if (!r.res.ok) fail(r);
    return r.data.challenge;
  }

  async function proofHeaders() {
    const c = await challenge();
    const p = await getAppProof(c, { attest: false });
    const kind = p.kind || "apple";
    return {
      "X-Changelark-Challenge": c,
      "X-Changelark-Proof-Kind": kind,
      "X-Changelark-Proof-Key": kind === "apple" ? p.keyId : "",
      "X-Changelark-Proof": kind === "apple" ? p.assertion : p.token,
    };
  }

  async function registerAppleKey() {
    const c = await challenge();
    const p = await getAppProof(c, { attest: true });
    const r = await send("/attest/register", { method: "POST", body: { keyId: p.keyId, attestation: p.attestation, challenge: c } });
    if (!r.res.ok && r.data?.error?.code !== "key_exists") fail(r);
  }

  async function call(path, opts = {}) {
    const write = opts.method && opts.method !== "GET";
    let r = await send(path, write && getAppProof ? { ...opts, headers: await proofHeaders() } : opts);
    if (write && getAppProof && r.data?.error?.code === "attestation_required") {
      await registerAppleKey();
      r = await send(path, { ...opts, headers: await proofHeaders() });
    }
    if (!r.res.ok) fail(r);
    return r.data;
  }

  return {
    config: () => call("/config"),
    whatsNew: (version) => call("/whats-new", { query: { version } }),
    releases: (cursor) => call("/releases", { query: { cursor } }),
    comments: (version, cursor) => call(`/releases/${encodeURIComponent(version)}/comments`, { query: { sort: "new", cursor } }),
    replies: (commentId, cursor) => call(`/comments/${commentId}/replies`, { query: { sort: "new", cursor } }),
    newReplies: (since) => call("/new-replies", { query: { since } }),
    vote: (targetType, targetId, value) => call("/votes", { method: "POST", body: { targetType, targetId, value } }),
    acceptGuidelines: () => call("/guidelines/accept", { method: "POST", body: {} }),
    addComment: (version, text, parentId = null) => call(`/releases/${encodeURIComponent(version)}/comments`, { method: "POST", body: { body: text, parentId } }),
    report: (commentId, reason = "abuse") => call("/reports", { method: "POST", body: { targetId: commentId, reason } }),
    deleteComment: (id) => call(`/comments/${id}`, { method: "DELETE", body: {} }),
    block: (commentId) => call("/blocks", { method: "POST", body: { commentId } }),
    // Private bug report, seen only by the developer. screenshot: base64 PNG/JPEG (e.g. from react-native-view-shot).
    reportBug: ({ text, screenshot = null, device = "" }) => call("/bugs", { method: "POST", body: { body: text, version: appVersion, screenshot, device } }),
  };
}

module.exports = { createClient };
