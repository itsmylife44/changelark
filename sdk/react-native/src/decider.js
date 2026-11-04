// When to show "What's new", vote toggling and version badges.
// Plain JavaScript with no React Native imports, so the web dashboard's phone simulator runs this same file.

// Versions compare by up to 4 numeric parts ("4.1" == "4.1.0").
function versionParts(v) {
  const p = String(v).split(".").slice(0, 4).map((x) => parseInt(x, 10) || 0);
  while (p.length < 4) p.push(0);
  return p;
}
function normVersion(v) {
  const p = versionParts(v);
  while (p.length > 1 && p[p.length - 1] === 0) p.pop();
  return p.join(".");
}
function cmpVersion(a, b) {
  const x = versionParts(a), y = versionParts(b);
  for (let i = 0; i < 4; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

function emptyState() {
  return { firstSeenVersion: null, lastKnownVersion: null, handledVersions: [], pendingSince: {}, repliesCheckedAt: null };
}

// Step 1, before any network call. Mutates `state`; persist it even when skipping.
// First install records the version quietly; seen or older versions are skipped.
function prepare(version, state, { treatFirstLaunchAsUpdate = false } = {}) {
  const key = normVersion(version);
  if (state.firstSeenVersion == null) {
    state.firstSeenVersion = key;
    state.lastKnownVersion = key;
    if (!treatFirstLaunchAsUpdate) { state.handledVersions.push(key); return { decision: "skip", reason: "first" }; }
  }
  if (state.handledVersions.includes(key)) return { decision: "skip", reason: "seen" };
  if (state.lastKnownVersion && cmpVersion(key, state.lastKnownVersion) < 0) {
    state.handledVersions.push(key);
    state.lastKnownVersion = key;
    return { decision: "skip", reason: "older" };
  }
  state.lastKnownVersion = key;
  return { decision: "fetch" };
}

// Step 2, after asking the server. `releaseState`: available | hidden | not_live_yet | notes_pending | unknown_version.
// Pending notes are retried for 3 days, unknown versions for 7, then given up.
function resolve(version, releaseState, state, now = Date.now()) {
  const key = normVersion(version);
  if (releaseState === "available") return { decision: "show" };
  if (releaseState === "hidden") { state.handledVersions.push(key); return { decision: "skip", reason: "hidden" }; }
  if (releaseState === "not_live_yet") return { decision: "skip", reason: "not_live_yet" };
  const since = state.pendingSince[key] ?? now;
  state.pendingSince[key] = since;
  const days = releaseState === "notes_pending" ? 3 : 7;
  if (now - since > days * 86400e3) state.handledVersions.push(key);
  return { decision: "skip", reason: "pending" };
}

// Step 3, only once the sheet was really on screen.
function markPresented(version, state) {
  const key = normVersion(version);
  if (!state.handledVersions.includes(key)) state.handledVersions.push(key);
  delete state.pendingSince[key];
}

// Votes are absolute (-1, 0, 1): pressing the same direction again clears it.
function toggleVote({ up, down, mine }, dir) {
  const next = mine === dir ? 0 : dir;
  if (mine === 1) up = Math.max(0, up - 1);
  if (mine === -1) down = Math.max(0, down - 1);
  if (next === 1) up++;
  if (next === -1) down++;
  return { up, down, mine: next };
}

function badge(version, installed, latest) {
  if (installed && cmpVersion(version, installed) === 0) return "Installed";
  if (latest && cmpVersion(version, latest) === 0 && cmpVersion(installed || "0", latest) !== 0) return "Latest";
  return null;
}

module.exports = { versionParts, normVersion, cmpVersion, emptyState, prepare, resolve, markPresented, toggleVote, badge };
