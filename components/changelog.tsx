"use client";
import { useCallback, useEffect, useState } from "react";
import { Brand, appIconUrl } from "./icons";
import { splitNotes } from "./sheet";
import { REPO_URL } from "../lib/site-url";
import { sdkClient, fmtLong, changelogHref } from "../lib/store";
import { supabase } from "../lib/supabase";
import type { PublicApp } from "../app/api/v1/public/[slug]/route";
import type { ApiComment, ApiConfig, ApiRelease, ChangelarkClient, ReportReason } from "../sdk/react-native/src/client";

// client and me are null while showing the server-rendered data, until this browser's install is known.
type Loaded = { app: PublicApp; client: ChangelarkClient | null; releases: ApiRelease[]; me: ApiConfig["me"] | null; comments: ApiComment[] | null; nextCursor?: string | null; releasesCursor?: string | null };
type Initial = { app: PublicApp; releases: ApiRelease[]; comments: ApiComment[] | null };
type PublicData = { missing: true } | { error: string } | Loaded;
interface ThreadCtx {
  who: string;
  readOnly: boolean; // the app accepts votes, reports and anonymous comments only from its official app
  canComment: boolean; // the developer still replies from the web
  vote(type: "release" | "comment", target: ApiRelease | ApiComment, dir: 1 | -1): Promise<void>;
  comment(text: string, parentId: string | null): Promise<void>;
  report(id: string, reason: ReportReason): Promise<void>;
}

// Starts from the server-rendered data, then reloads through the same API the in-app packages use,
// which adds this browser's votes and hides what it blocked or reported.
function usePublic(slug: string, version?: string, initial?: Initial, lang?: string) {
  const [data, setData] = useState<PublicData | null>(initial ? { ...initial, client: null, me: null } : null);
  const load = useCallback(async () => {
    const res = await fetch(`/api/v1/public/${encodeURIComponent(slug)}`);
    if (!res.ok) return setData({ missing: true });
    const app: PublicApp = await res.json();
    const client = sdkClient(app.key, undefined, undefined, lang);
    try {
      const [list, config, comments, own] = await Promise.all([
        client.releases(),
        client.config(),
        version ? client.comments(version).catch(() => null) : null,
        // A version page loads its own release, which may be older than the first page of the list.
        version ? client.whatsNew(version).catch(() => null) : null,
      ]);
      const releases = list.items;
      if (own?.release && !releases.some((r) => r.id === own.release!.id)) releases.push(own.release);
      setData({ app, client, releases, releasesCursor: list.nextCursor, me: config.me, comments: comments?.items ?? null, nextCursor: comments?.nextCursor ?? null });
    } catch (e) {
      setData({ error: (e as Error).message });
    }
  }, [slug, version, lang]);
  useEffect(() => { load(); }, [load]);
  // Appends the next page of threads.
  const more = useCallback(async () => {
    if (!data || !("app" in data) || !data.client || !data.nextCursor || !version) return;
    const page = await data.client.comments(version, data.nextCursor);
    setData({ ...data, comments: [...(data.comments || []), ...page.items], nextCursor: page.nextCursor });
  }, [data, version]);
  const moreReleases = useCallback(async () => {
    if (!data || !("app" in data) || !data.client || !data.releasesCursor) return;
    const page = await data.client.releases(data.releasesCursor);
    setData({ ...data, releases: [...data.releases, ...page.items], releasesCursor: page.nextCursor });
  }, [data]);
  return [data, load, more, moreReleases] as const;
}

// Two columns: the app and its version index stay on the left, the content on the right.
function Shell({ app, releases, current, lang, children }: { app?: PublicApp; releases?: ApiRelease[]; current?: string; lang?: string; children: React.ReactNode }) {
  const languages = [...new Set((releases || []).flatMap((r) => r.languages || []))].sort();
  return (
    <div className="cl">
      <aside className="cl-side">
        <div className="cl-side-inner">
          {/* Only the app's developer has a dashboard to go back to; visitors never see this. */}
          {app?.isOwner && <a className="cl-back" href={`/#app/${app.slug}`}>← Dashboard</a>}
          {app && (
            <>
              <a className="cl-app" href={changelogHref(app, undefined, lang)}>
                <img className="public-app-icon" src={appIconUrl(app.color)} alt="" width="44" height="44" />
                {current ? <strong>{app.name}</strong> : <h1>{app.name}</h1>}
              </a>
              <p className="label">Changelog</p>
            </>
          )}
          {releases && releases.length > 0 && (
            <nav className="cl-index" aria-label="Versions">
              <ol>
                {releases.map((r) => (
                  <li key={r.version}>
                    <a href={changelogHref(app!, r.version, lang)} aria-current={current === r.version ? "page" : undefined}>
                      <span>{r.version}</span><time>{fmtLong(r.date).replace(/, \d{4}$/, "")}</time>
                    </a>
                  </li>
                ))}
              </ol>
            </nav>
          )}
          {app && languages.length > 0 && (
            <nav className="cl-langs" aria-label="Language">
              <a href={changelogHref(app, current)} aria-current={!lang ? "page" : undefined}>Original</a>
              {languages.map((l) => <a key={l} href={changelogHref(app, current, l)} aria-current={lang === l ? "page" : undefined} lang={l}>{l.toUpperCase()}</a>)}
            </nav>
          )}
          <div className="cl-links">
            {app && <a href={`/apps/${app.slug}/feed.xml`} type="application/rss+xml">RSS feed</a>}
            {app?.storeUrl && <a href={app.storeUrl}>App Store ↗</a>}
            {app?.contact && <a href={app.contact}>Contact the developer</a>}
          </div>
          <div className="cl-powered"><Brand href={REPO_URL} /><span>open-source changelogs</span></div>
        </div>
      </aside>
      <main className="cl-main">{children}</main>
    </div>
  );
}

function NotFound({ error }: { error?: string }) {
  return (
    <Shell>
      <section className="cl-entry">
        <p className="label">Changelog</p>
        <h1>{error ? "Couldn't load this page." : "Nothing here yet."}</h1>
        <p className="lead">{error || "This changelog doesn't exist."}</p>
      </section>
    </Shell>
  );
}

function Notes({ text }: { text: string }) {
  const { text: paras, bullets } = splitNotes(text);
  return (
    <div className="cl-notes">
      {paras.map((p, i) => <p key={i}>{p}</p>)}
      {bullets.length > 0 && <ul>{bullets.map((b, i) => <li key={i}>{b}</li>)}</ul>}
    </div>
  );
}

export function ChangelogPage({ slug, initial, lang }: { slug: string; initial?: Initial; lang?: string }) {
  const [data, , , moreReleases] = usePublic(slug, undefined, initial, lang);
  const [open, setOpen] = useState(false);
  if (!data) return null;
  if (!("app" in data)) return <NotFound error={"error" in data ? data.error : undefined} />;
  const { app, releases } = data;
  const intro = app.description.split(/\n\s*\n/)[0];
  return (
    <Shell app={app} releases={releases} lang={lang}>
      {app.description && (
        <section className="cl-about">
          <p className="app-description-text">{open ? app.description : intro}</p>
          {intro !== app.description && (
            <button className="app-description-toggle" type="button" aria-expanded={open} onClick={() => setOpen(!open)}>
              {open ? "Show less" : "Full description"}
            </button>
          )}
        </section>
      )}
      {releases.length === 0 && <div className="community-empty"><h2>No updates yet</h2><p>The first version shows up here as soon as it&apos;s published.</p></div>}
      {releases.map((r) => (
        <article className="cl-entry" id={`v${r.version}`} key={r.version}>
          <header className="cl-entry-head">
            <h2><a href={changelogHref(app, r.version, lang)}>{r.version}</a></h2>
            <time>{fmtLong(r.date)}</time>
          </header>
          <Notes text={r.notes} />
          <a className="cl-discuss" href={changelogHref(app, r.version, lang)}>
            <span>👍 {r.upCount}</span><span>👎 {r.downCount}</span><span>{r.commentCount} {r.commentCount === 1 ? "comment" : "comments"}</span><b>Join the discussion →</b>
          </a>
        </article>
      ))}
      {"releasesCursor" in data && data.releasesCursor && <p><button type="button" className="button button-quiet" onClick={moreReleases}>Load more versions</button></p>}
    </Shell>
  );
}

function initials(name: string) {
  return name.split(" ").slice(0, 2).map((w) => w[0]).join("").toUpperCase();
}

function CommentForm({ onSend, placeholder = "Share what you think of this update…", who, autoFocus, onCancel }: { onSend: (text: string) => Promise<void>; placeholder?: string; who: string; autoFocus?: boolean; onCancel?: () => void }) {
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  return (
    <form className="cl-compose" onSubmit={async (e) => {
      e.preventDefault();
      if (!text.trim()) return;
      try { await onSend(text); setText(""); setError(""); } catch (err) { setError((err as Error).message); }
    }}>
      <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder} maxLength={1000} autoFocus={autoFocus} aria-label="Comment" />
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="row">
        <span>Posting as <strong>{who}</strong>, no account needed. Be kind and stay on topic.</span>
        <span style={{ display: "flex", gap: 8 }}>
          {onCancel && <button type="button" className="text-btn" onClick={onCancel}>Cancel</button>}
          <button className="button small" type="submit" disabled={!text.trim()}>Post</button>
        </span>
      </div>
    </form>
  );
}

function ReportControl({ onReport }: { onReport: (reason: ReportReason) => void }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<ReportReason>("spam");
  if (!open) return <button type="button" className="cl-act" onClick={() => setOpen(true)}>Report</button>;
  return (
    <span className="report-control">
      <select value={reason} onChange={(e) => setReason(e.target.value as ReportReason)} aria-label="Reason">
        <option value="spam">Spam</option>
        <option value="abuse">Abuse or harassment</option>
        <option value="off-topic">Off topic</option>
      </select>
      <button type="button" onClick={() => onReport(reason)}>Send</button>
      <button type="button" onClick={() => setOpen(false)}>Cancel</button>
    </span>
  );
}

// One message of the discussion, chat-style, with its replies under it.
function Message({ c, ctx }: { c: ApiComment; ctx: ThreadCtx }) {
  const [replying, setReplying] = useState(false);
  const dev = c.author.kind === "developer";
  return (
    <li className={"cl-msg" + (dev ? " is-dev" : "") + (c.author.isMe ? " is-mine" : "")}>
      <span className="cl-avatar" aria-hidden="true">{initials(c.author.name)}</span>
      <div className="cl-bubble">
        <div className="cl-msg-head">
          <strong>{c.author.isMe ? `${c.author.name} (you)` : c.author.name}</strong>
          {dev && <span className="badge-dev">Developer</span>}
          <time>{fmtLong(c.createdAt.slice(0, 10))}</time>
        </div>
        <p className={"cl-msg-text" + (c.removed ? " removed-comment" : "")}>{c.deletedByAuthor ? "Deleted by its author." : c.removed ? "This comment has been hidden because it violated the community guidelines." : c.body}</p>
        {!c.removed && (
          <div className="cl-msg-actions">
            <button type="button" className="cl-act" disabled={ctx.readOnly} aria-pressed={c.myVote === 1} onClick={() => ctx.vote("comment", c, 1)} aria-label={`Like, ${c.upCount}`}>{c.myVote === 1 ? "♥" : "♡"} {c.upCount}</button>
            {ctx.canComment && <button type="button" className="cl-act" aria-label="Reply" aria-expanded={replying} onClick={() => setReplying(!replying)}>↩︎</button>}
            {!dev && !c.author.isMe && !ctx.readOnly && <ReportControl onReport={(r) => ctx.report(c.id, r)} />}
          </div>
        )}
        {replying && <CommentForm autoFocus who={ctx.who} placeholder={`Reply to ${c.author.name}…`} onCancel={() => setReplying(false)} onSend={async (t) => { await ctx.comment(t, c.id); setReplying(false); }} />}
        {c.replies.length > 0 && <ol className="cl-replies">{c.replies.map((r) => <Message key={r.id} c={r} ctx={ctx} />)}</ol>}
      </div>
    </li>
  );
}

function countVisible(list: ApiComment[]): number {
  return list.reduce((n, c) => n + (c.removed ? 0 : 1) + countVisible(c.replies), 0);
}

export function ReleasePage({ slug, version, initial, lang }: { slug: string; version: string; initial?: Initial; lang?: string }) {
  const [data, reload, more] = usePublic(slug, version, initial, lang);
  if (!data) return null;
  if (!("app" in data)) return <NotFound error={"error" in data ? data.error : undefined} />;
  const { app, client, me, comments } = data;
  const r = data.releases.find((x) => x.version === version);
  if (!r || !comments) return <NotFound />;
  const ctx: ThreadCtx = {
    readOnly: app.readOnly,
    canComment: !app.readOnly || app.isOwner,
    who: app.isOwner ? "you (Developer)" : me?.name ?? "…",
    vote: async (type, target, dir) => { if (!client) return; await client.vote(type, target.id, target.myVote === dir ? 0 : dir).catch((e: Error) => alert(e.message)); reload(); },
    comment: async (text, parentId) => {
      if (app.isOwner) {
        // The developer posts with their own account (RLS checks they own the app).
        const sb = supabase();
        const { data: { user } } = await sb.auth.getUser();
        const { error } = await sb.from("comments").insert({ release_id: r.id, parent_id: parentId, body: text.trim(), author_name: user?.user_metadata?.name || "Developer", is_dev: true });
        if (error) throw error;
      } else {
        if (!client || !me) throw new Error("Still loading, try again in a moment.");
        if (!me.guidelinesAccepted) await client.acceptGuidelines();
        await client.addComment(version, text.trim(), parentId);
      }
      await reload();
    },
    report: async (id, reason) => { if (!client) return; await client.report(id, reason).catch((e: Error) => alert(e.message)); reload(); },
  };
  return (
    <Shell app={app} releases={data.releases} current={r.version} lang={lang}>
      <article className="cl-entry cl-single">
        <a className="read-more" href={changelogHref(app, undefined, lang)}>← All versions</a>
        <header className="cl-entry-head">
          <h1>Version {r.version}</h1>
          <time>{fmtLong(r.date)}</time>
        </header>
        <Notes text={r.notes} />
        <div className="as-react cl-react" role="group" aria-label="Your reaction">
          <button type="button" disabled={ctx.readOnly} aria-pressed={r.myVote === 1} onClick={() => ctx.vote("release", r, 1)}><span aria-hidden="true">👍</span> Love it <em>{r.upCount}</em></button>
          <button type="button" disabled={ctx.readOnly} aria-pressed={r.myVote === -1} onClick={() => ctx.vote("release", r, -1)}><span aria-hidden="true">👎</span> Not for me <em>{r.downCount}</em></button>
        </div>
      </article>
      <section className="cl-discussion" aria-labelledby="discussion">
        <h2 id="discussion">Discussion <span className="community-count">{countVisible(comments)}</span></h2>
        {comments.length === 0 ? (
          <p className="empty-state">No comments yet. Be the first to say what you think of {r.version}.</p>
        ) : (
          <ol className="cl-thread">{comments.map((c) => <Message key={c.id} c={c} ctx={ctx} />)}</ol>
        )}
        {data.nextCursor && <div><button type="button" className="button button-quiet" onClick={more}>Load more comments</button></div>}
        {!ctx.canComment
          ? <p className="callout muted">Votes and comments for {app.name} happen inside the app, so only people using the real app can join in.</p>
          : <CommentForm who={ctx.who} onSend={(t) => ctx.comment(t, null)} />}
      </section>
    </Shell>
  );
}
