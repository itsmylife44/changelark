"use client";
// The Preview tab: a pretend phone running your app with the Changelark package, so you see what your users see.
// It is a real anonymous install: it talks to /api/v1/sdk with the app's public key, like the mobile packages.
import { useCallback, useEffect, useState } from "react";
import decider, { type DeviceState, type SkipReason } from "../sdk/react-native/src/decider";
import type { ApiComment, ApiConfig, ApiRelease, ChangelarkClient } from "../sdk/react-native/src/client";
import { sdkClient, rid, type App } from "../lib/store";
import { SheetBody, ChatThread, type ChatMessage } from "./sheet";

type Device = DeviceState & { installId: string };

const WHY: Record<SkipReason, string> = {
  first: "First launch: version recorded quietly. Nobody is interrupted on a fresh install.",
  seen: "Already seen: What's new shows only once per version.",
  older: "Older version than before: skipped.",
  pending: "No published notes for this version yet: the sheet waits until they exist.",
  not_live_yet: "The notes for this version have a future release date: the sheet waits until then.",
  hidden: "This version's notes are hidden: skipped.",
};

// What the device remembers between launches (UserDefaults / AsyncStorage in the real packages).
const storageKey = (slug: string) => `changelark:device:${slug}`;
function loadDevice(slug: string): Device {
  try { const d = JSON.parse(localStorage.getItem(storageKey(slug)) || "null"); if (d?.installId) return d; } catch {}
  return { installId: rid(24), ...decider.emptyState() };
}
const saveDevice = (slug: string, d: Device) => localStorage.setItem(storageKey(slug), JSON.stringify(d));

type Msg = ChatMessage & { c: ApiComment; replies?: Msg[] };
// Comment tree → thread, oldest first, replies under what they answer.
function toMsg(c: ApiComment): Msg {
  return {
    c, id: c.id, author: c.author.name, text: c.body, mine: c.author.isMe, dev: c.author.kind === "developer",
    removed: c.deletedByAuthor ? "Deleted by its author." : c.removed ? "Hidden for breaking the community guidelines." : undefined,
    replies: c.replies.map(toMsg),
  };
}
const toChat = (items: ApiComment[]) => [...items].reverse().map(toMsg);

export default function PhoneSim({ app }: { app: App }) {
  const [d, setD] = useState<Device | null>(null);
  const [installed, setInstalled] = useState<string | null>(null);
  const [releases, setReleases] = useState<ApiRelease[]>([]);
  const [me, setMe] = useState<ApiConfig["me"] | null>(null);
  const [proofRequired, setProofRequired] = useState(false);
  const [sheet, setSheet] = useState<ApiRelease | null>(null);
  const [chat, setChat] = useState<ApiComment[] | null>(null); // open when not null
  const [text, setText] = useState("");
  const [replyTo, setReplyTo] = useState<ApiComment | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [bug, setBug] = useState<"" | "open" | "sent">("");
  const [bugText, setBugText] = useState("");
  const [log, setLog] = useState<string[]>([]);
  const say = (t: string) => setLog((l) => [t, ...l].slice(0, 6));

  useEffect(() => setD(loadDevice(app.slug)), [app.slug]);
  const client: ChangelarkClient | null = d && sdkClient(app.key, d.installId, installed || "1.0");

  const reload = useCallback(async () => {
    if (!client) return;
    const [{ items }, config] = await Promise.all([client.releases(), client.config()]);
    setReleases(items);
    setMe(config.me);
    setProofRequired(config.app.proofRequired);
    setInstalled((v) => v ?? items[0]?.version ?? "1.0");
    setSheet((s) => (s ? items.find((r) => r.id === s.id) || s : s));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d?.installId, app.key]);
  useEffect(() => { reload().catch((e: Error) => say("Server error: " + e.message)); }, [reload]);

  if (!d || !me || !client) return <div className="panel"><p>Starting the phone…</p></div>;
  const latest = releases[0]?.version || null;

  const loadChat = async (version: string) => setChat((await client.comments(version)).items);
  // Runs an SDK call, then refreshes what's on screen. Returns true when it worked.
  const act = async (fn: (c: ChangelarkClient) => Promise<unknown>, msg?: string) => {
    try {
      await fn(client);
      if (msg) say(msg);
      await reload();
      if (chat && sheet) await loadChat(sheet.version);
      return true;
    } catch (e) { say((e as Error).message); return false; }
  };

  // The package's launch logic: decide locally, ask the server, show, remember.
  async function open() {
    if (!d || !client || !installed) return;
    const state: Device = { ...d, handledVersions: [...d.handledVersions], pendingSince: { ...d.pendingSince } };
    setSheet(null); setChat(null); setBug("");
    const first = decider.prepare(installed, state);
    let shown: ApiRelease | null = null;
    if (first.decision === "skip") say(WHY[first.reason]);
    else {
      try {
        const res = await client.whatsNew(installed);
        const next = decider.resolve(installed, res.state, state);
        if (next.decision === "show" && res.state === "available") { decider.markPresented(installed, state); shown = res.release; say(`Opened version ${installed}: What's new shown.`); }
        else if (next.decision === "skip") say(WHY[next.reason]);
      } catch (e) { say("Offline or server error, will retry next launch: " + (e as Error).message); }
    }
    saveDevice(app.slug, state);
    setD(state);
    setSheet(shown);
  }

  function reset() {
    const fresh: Device = { installId: rid(24), ...decider.emptyState() };
    saveDevice(app.slug, fresh);
    setD(fresh); setSheet(null); setChat(null);
    say("Phone reset: like a fresh install.");
  }

  const react = (r: ApiRelease, dir: 1 | -1) => act((cl) => cl.vote("release", r.id, r.myVote === dir ? 0 : dir));
  const messages = chat ? toChat(chat) : [];
  const commentCount = (chat || []).reduce((n, c) => n + 1 + c.replies.length, 0);

  return (
    <div className="phone-wrap">
      <div className="panel phone-controls">
        <h1>See what your users see</h1>
        {proofRequired && <p className="callout muted">This app requires app proofs, so the pretend phone can read but not vote or comment. Real installs prove themselves with App Attest or Play Integrity.</p>}
        <p>The phone on the right is your app with the Changelark package, talking to this server like a real install. Choose which version is installed and launch it. To watch What&apos;s new appear, launch an older version first (like 2.3), then the newest one.</p>
        <form className="dash-form" onSubmit={(e) => { e.preventDefault(); open(); }}>
          <label>Installed version
            <input value={installed || ""} onChange={(e) => setInstalled(e.target.value)} list={`v-${app.slug}`} pattern="\d+(\.\d+){0,3}" required />
            <datalist id={`v-${app.slug}`}>{releases.map((r) => <option key={r.version} value={r.version} />)}</datalist>
          </label>
          <div className="row">
            <button className="button" type="submit">Launch the app</button>
            <button className="button button-quiet" type="button" onClick={reset}>Reset phone</button>
          </div>
        </form>
        <p className="phone-state">{d.firstSeenVersion ? `Installed first at ${d.firstSeenVersion}. Seen: ${d.handledVersions.join(", ") || "none"}.` : "Not opened yet (fresh install)."}</p>
        <ul className="phone-log" aria-live="polite">{log.map((t, i) => <li key={i}>{t}</li>)}</ul>
      </div>

      <div className="phone" aria-label="Phone preview">
        <div className="phone-home">
          <div className="phone-icon" style={{ background: app.color }} />
          <strong>{app.name.split(":")[0]}</strong>
          <small>Version {installed}</small>
          <button type="button" className="phone-primary" onClick={() => setSheet(releases.find((r) => decider.cmpVersion(r.version, installed || "") === 0) || releases[0] || null)} disabled={!releases.length}>What&apos;s new</button>
        </div>

        {sheet && bug && (
          <div className="phone-sheet app-sheet is-full" role="dialog" aria-label="Report a bug">
            <div className="as-body phone-chat">
              <div className="as-title"><button type="button" className="text-btn" onClick={() => { setBug(""); setBugText(""); }}>‹ Back</button><h2>Report a bug</h2><span /></div>
              {bug === "sent" ? <p className="as-empty">Thanks! The developer got your report.</p> : (
                <form className="phone-bug" onSubmit={async (e) => {
                  e.preventDefault();
                  if (bugText.trim() && (await act((cl) => cl.reportBug({ text: bugText.trim(), device: "Pretend phone" }), "Bug report sent. It's in the inbox under Bugs."))) setBug("sent");
                }}>
                  <p className="as-empty">Only the developer sees this. The real packages can attach a screenshot.</p>
                  <textarea value={bugText} onChange={(e) => setBugText(e.target.value)} placeholder="What went wrong?" aria-label="Describe the bug" maxLength={2000} />
                  <button type="submit" className="phone-primary" disabled={!bugText.trim()}>Send report</button>
                </form>
              )}
            </div>
          </div>
        )}

        {sheet && !chat && !bug && (
          <div className="phone-sheet app-sheet" role="dialog" aria-label="What's new">
            <SheetBody
              release={{ version: sheet.version, date: sheet.date, notes: sheet.notes, up: sheet.upCount, down: sheet.downCount, mine: sheet.myVote, comments: sheet.commentCount }}
              badge={decider.badge(sheet.version, installed, latest)}
              onReact={(dir) => react(sheet, dir)}
              onFeedback={() => loadChat(sheet.version)}
              onBug={proofRequired ? undefined : () => setBug("open")}
              onClose={() => setSheet(null)}
            />
          </div>
        )}

        {sheet && chat && (
          <div className="phone-sheet app-sheet is-full" role="dialog" aria-label="Feedback">
            <div className="as-body phone-chat">
              <div className="as-title">
                <button type="button" className="text-btn" onClick={() => { setChat(null); setMenu(null); }}>‹ {sheet.version}</button>
                <h2>{commentCount === 1 ? "1 comment" : `${commentCount} comments`}</h2>
                <button type="button" className="text-btn" onClick={() => { setChat(null); setSheet(null); setMenu(null); }}>Close</button>
              </div>
              <ChatThread messages={messages} actions={(m) => {
                const c = (m as Msg).c;
                return (
                  <div className="as-actions">
                    <button type="button" aria-label={`Like, ${c.upCount}`} aria-pressed={c.myVote === 1} onClick={() => act((cl) => cl.vote("comment", c.id, c.myVote === 1 ? 0 : 1))}>{c.myVote === 1 ? "♥" : "♡"} {c.upCount}</button>
                    {!c.parentId && <button type="button" aria-label="Reply" onClick={() => setReplyTo(c)}>↩︎</button>}
                    <button type="button" aria-label="More" onClick={() => setMenu(menu === c.id ? null : c.id)}>···</button>
                    {menu === c.id && (
                      <span className="phone-menu">
                        {c.author.isMe ? (
                          <button type="button" onClick={() => { setMenu(null); act((cl) => cl.deleteComment(c.id)); }}>Delete comment</button>
                        ) : (
                          <>
                            <button type="button" onClick={() => { setMenu(null); act((cl) => cl.report(c.id, "abuse"), "Reported. It's hidden for you and sent to the developer."); }}>Report</button>
                            {c.author.kind !== "developer" && <button type="button" onClick={() => { setMenu(null); act((cl) => cl.block(c.id), `You won't see ${c.author.name} anymore.`); }}>Block {c.author.name}</button>}
                          </>
                        )}
                        <button type="button" onClick={() => setMenu(null)}>Cancel</button>
                      </span>
                    )}
                  </div>
                );
              }} />
              {!me.guidelinesAccepted ? (
                <div className="phone-guidelines">
                  <strong>Before you write</strong>
                  <p>Be kind and stay on topic. No spam, no personal attacks. You stay anonymous as <b>{me.name}</b>.</p>
                  <button type="button" className="phone-primary" onClick={() => act((cl) => cl.acceptGuidelines())}>Accept and continue</button>
                </div>
              ) : (
                <form className="phone-compose" onSubmit={async (e) => {
                  e.preventDefault();
                  if (!text.trim()) return;
                  if (await act((cl) => cl.addComment(sheet.version, text.trim(), replyTo?.id || null))) { setText(""); setReplyTo(null); }
                }}>
                  {replyTo && <span className="phone-chip">Replying to {replyTo.author.isMe ? "yourself" : replyTo.author.name} <button type="button" aria-label="Cancel reply" onClick={() => setReplyTo(null)}>✕</button></span>}
                  <div>
                    <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Message…" aria-label="Add a comment" maxLength={1000} />
                    <button type="submit" disabled={!text.trim()}>Send</button>
                  </div>
                </form>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
