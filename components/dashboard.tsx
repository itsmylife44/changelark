"use client";
// The developer workspace, laid out like a feedback inbox:
// top bar with the app switcher · versions on the left · the selected version in the middle · live feedback on the right.
import { SWIFT_PACKAGE_URL, REPO_URL } from "../lib/site-url";
import { useEffect, useRef, useState } from "react";
import { AppMark, BrandMark } from "./icons";
import { CopyCode, ThemeSwitch } from "./widgets";
import PhoneSim from "./phone";
import { SheetBody, ChatThread, type ChatMessage } from "./sheet";
import {
  useStore, currentUser, sortedReleases, rotateKey, visibleComments, logout, addApp, updateApp, deleteApp,
  addRelease, updateRelease, deleteRelease, addComment, setHidden, dismissReports, resetDemo, enterDemo, deleteAccount, DEMO, ascConnect, ascDisconnect, ascApps, ascLink, ascSync, type AscConnection, type AscApp, updateProofs, playConnect, playDisconnect, updateName, changeEmail, changePassword, setEmailAlerts,
  fmtShort, changelogHref, type App, type AppFields, type Comment, type Release,
  setWebhook, testWebhook, setBugResolved, deleteBug, screenshotUrl, type Bug,
} from "../lib/store";

interface View { name: string; slug?: string; version?: string }
type Go = (name: string, slug?: string, version?: string) => void;
type Flash = (text: string) => void;
type Sheet = { app: App; r: Release };
interface FeedRow { app: App; rel: Release; c: Comment }
interface BugRow { app: App; b: Bug }
type Filter = "all" | "reports" | "bugs";

const COLORS = ["#007AFF", "#FF7A1A", "#1F9D55", "#6D5EF6", "#FF2D55", "#111111"];
const today = () => new Date().toISOString().slice(0, 10);
const letterOf = (a: App) => a.name[0];
const shortName = (a: App) => a.name.split(":")[0];

function parseHash(): View {
  const [name = "", slug, version] = decodeURIComponent(location.hash.slice(1)).split("/");
  // Older links keep working: #release/app/1.0 → the version in its app, #comments / #reports → the inbox.
  if (name === "release") return { name: "app", slug, version };
  if (name === "comments") return { name: "inbox" };
  if (name === "reports") return { name: "inbox", version: "reports" };
  return { name, slug, version };
}

// smtpConfigured: the server can send email (SMTP_URL set); without it email alerts are hidden.
// demo: signed-out visitors get the shared demo workspace; otherwise they're sent to the login.
export default function Dashboard({ smtpConfigured, demo }: { smtpConfigured: boolean; demo: boolean }) {
  const state = useStore();
  const [view, setView] = useState<View>({ name: "" });
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [toast, setToast] = useState("");

  useEffect(() => {
    setView(parseHash());
    const onHash = () => setView(parseHash());
    addEventListener("hashchange", onHash);
    return () => removeEventListener("hashchange", onHash);
  }, []);

  // <details> only closes when its summary is clicked again. Also close the account menu on a click outside it,
  // on a link inside it, and on Escape (focus goes back to the name). The theme buttons keep it open.
  const menu = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const m = menu.current, target = e.target as Element;
      if (m?.open && (!m.contains(target) || target.closest(".menu-pop a"))) m.open = false;
    };
    const onKey = (e: KeyboardEvent) => {
      const m = menu.current;
      if (e.key === "Escape" && m?.open) { m.open = false; m.querySelector("summary")?.focus(); }
    };
    document.addEventListener("click", onClick);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("click", onClick); document.removeEventListener("keydown", onKey); };
  }, []);

  const me = currentUser(state);
  useEffect(() => {
    if (!state.ready || me) return;
    if (demo) enterDemo().then((e) => e && alert(e));
    else location.replace("/login");
  }, [state.ready, me, demo]);
  if (!me) return null;

  const go: Go = (name, slug, version) => { location.hash = [name, slug, version].filter(Boolean).join("/"); };
  const flash: Flash = (t) => { setToast(t); setTimeout(() => setToast(""), 1800); };
  const apps = state.apps;
  // No app picked yet: open the one with the newest version, so there's always a workspace on screen.
  const latest = (a: App) => a.releases.reduce((m, r) => (r.date > m ? r.date : m), "");
  const app = apps.find((a) => a.slug === view.slug) || (["", "apps"].includes(view.name) ? [...apps].sort((a, b) => latest(b).localeCompare(latest(a)))[0] : undefined);
  const name = ["", "apps"].includes(view.name) ? (apps.length ? "app" : "connect") : view.name;
  const rows: FeedRow[] = apps.flatMap((a) => a.releases.flatMap((r) => r.comments.filter((c) => !c.deleted).map((c) => ({ app: a, rel: r, c }))));
  const bugs: BugRow[] = apps.flatMap((a) => a.bugs.map((b) => ({ app: a, b })));
  const reported = rows.filter((x) => x.c.reports.length).length + bugs.filter((x) => !x.b.resolved).length;
  const tab = (t: string) => (name === t || (t === "app" && name === "app")) ? "page" : undefined;

  let body: React.ReactNode;
  if (name === "connect") body = <Connect first={!apps.length} onDone={(slug) => { flash("App added"); go("app", slug); }} />;
  else if (name === "inbox") body = <Inbox rows={rows} bugs={bugs} filter={view.version === "reports" ? "reports" : view.slug === "bugs" ? "bugs" : "all"} go={go} flash={flash} />;
  else if (name === "account") body = <div className="page-narrow"><AccountView me={me} apps={apps} asc={state.asc} play={state.play} emailAlerts={state.emailAlerts} smtpConfigured={smtpConfigured} flash={flash} /></div>;
  else if (!app) body = <div className="page-narrow"><p className="empty-state">That app isn&apos;t in your workspace. <button className="text-btn" onClick={() => go("")}>Open your apps</button></p></div>;
  else if (name === "sdk") body = <div className="page-narrow"><SdkView app={app} go={go} /></div>;
  else if (name === "preview") body = <div className="page-wide"><PhoneSim key={app.slug} app={app} /></div>;
  else if (name === "settings") body = <div className="page-narrow"><Settings app={app} asc={state.asc} play={state.play} go={go} flash={flash} /></div>;
  else body = <Workspace key={app.slug} app={app} selected={view.version} rows={rows.filter((x) => x.app.id === app.id)} bugs={bugs.filter((x) => x.app.id === app.id)} go={go} flash={flash} preview={(r) => setSheet({ app, r })} />;

  return (
    <div className="dash">
      <header className="topbar">
        <a className="brand" href="#"><BrandMark />Changelark</a>
        {apps.length > 0 && (
          <label className="app-switch">
            <span className="sr-only">App</span>
            {app && <AppMark color={app.color} letter={letterOf(app)} />}
            <select value={app && name !== "connect" && name !== "inbox" && name !== "account" ? app.slug : ""} onChange={(e) => e.target.value === "+" ? go("connect") : go("app", e.target.value)}>
              {!(app && !["connect", "inbox", "account"].includes(name)) && <option value="">Choose an app</option>}
              {apps.map((a) => <option key={a.slug} value={a.slug}>{a.name}</option>)}
              <option value="+">+ Add an app</option>
            </select>
          </label>
        )}
        {app && ["app", "sdk", "preview", "settings"].includes(name) && (
          <nav className="app-tabs" aria-label="App">
            <a href={`#app/${app.slug}`} aria-current={tab("app")}>Versions</a>
            <a href={`#sdk/${app.slug}`} aria-current={tab("sdk")}>Install</a>
            <a href={`#preview/${app.slug}`} aria-current={tab("preview")}>Preview</a>
            <a href={`#settings/${app.slug}`} aria-current={tab("settings")}>Settings</a>
          </nav>
        )}
        <span className="spacer" />
        <a className="top-link" href="#inbox" aria-current={name === "inbox" ? "page" : undefined}>Inbox{reported > 0 && <b className="count-badge" aria-label={`${reported} need attention`}>{reported}</b>}</a>
        <details className="menu" ref={menu}>
          <summary className="top-link" aria-label="Account menu"><span className="side-user">{me.name}</span> ▾</summary>
          <div className="menu-pop">
            <p className="menu-who">{me.email}</p>
            <a href="#account">Account</a>
            {me.email === DEMO.email && <a href="/signup">Create your own account</a>}
            {me.email === DEMO.email && <button onClick={async () => { if (confirm("Reset the demo workspace to how it started?")) { await resetDemo(); flash("Demo reset"); } }}>Reset demo</button>}
            <a href="/docs">Docs</a>
            <a href={REPO_URL}>Changelark on GitHub ↗</a>
            <ThemeSwitch />
            <button onClick={async () => { await logout(); location.href = "/login"; }}>Log out</button>
          </div>
        </details>
      </header>
      <main className="dash-main">{body}</main>
      {sheet && <WhatsNew app={sheet.app} r={sheet.r} onClose={() => setSheet(null)} />}
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}

function AppForm({ initial, submitLabel, onSubmit }: { initial: AppFields; submitLabel: string; onSubmit: (f: AppFields) => void }) {
  const [f, setF] = useState(initial);
  const set = (k: keyof AppFields) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <form className="dash-form" onSubmit={(e) => { e.preventDefault(); if (f.name.trim()) onSubmit(f); }}>
      <label>App name<input value={f.name} onChange={set("name")} required placeholder="e.g. Tidepool: Tides & Surf" /></label>
      <label>Description<textarea value={f.description} onChange={set("description")} placeholder="What your app does, shown on the public changelog." /></label>
      <label>App Store link<input type="url" value={f.storeUrl} onChange={set("storeUrl")} placeholder="https://apps.apple.com/app/id…" /></label>
      <label>Contact link<input value={f.contact} onChange={set("contact")} placeholder="mailto:you@example.com" /></label>
      <label>Icon colour
        <span className="row">
          {COLORS.map((c) => (
            <button type="button" key={c} aria-label={c} aria-pressed={f.color === c} onClick={() => setF({ ...f, color: c })}
              style={{ width: 26, height: 26, borderRadius: 7, background: c, border: f.color === c ? "2px solid #111" : "2px solid transparent", outline: f.color === c ? "2px solid #fff" : "none", outlineOffset: -4, cursor: "pointer" }} />
          ))}
        </span>
      </label>
      <div className="row"><button className="button" type="submit">{submitLabel}</button></div>
    </form>
  );
}

function Connect({ first, onDone }: { first: boolean; onDone: (slug: string) => void }) {
  return (
    <div className="page-narrow">
      <div className="panel">
        <h1 className="page-title">{first ? "Add your first app" : "Add an app"}</h1>
        <p>Each app gets a public changelog page, a key for the in-app package and its own feedback inbox.</p>
        <AppForm initial={{ name: "", description: "", storeUrl: "", contact: "", color: "#007AFF" }} submitLabel="Add app" onSubmit={async (f) => { const r = await addApp(f); if ("error" in r) alert(r.error); else onDone(r.slug); }} />
      </div>
    </div>
  );
}

// ---------- the versions workspace ----------
function Workspace({ app, selected, rows, bugs, go, flash, preview }: { app: App; selected?: string; rows: FeedRow[]; bugs: BugRow[]; go: Go; flash: Flash; preview: (r: Release) => void }) {
  const releases = sortedReleases(app);
  const current = selected === "new" ? null : releases.find((r) => r.version === selected) || releases[0] || null;
  const creating = selected === "new" || !releases.length;
  return (
    <div className="workspace" data-app-id={app.id}>
      <nav className="timeline" aria-label="Versions">
        <a className="button new-version" href={`#app/${app.slug}/new`} aria-current={creating ? "page" : undefined}>+ New version</a>
        <ol>
          {releases.map((r) => {
            const n = visibleComments(r).length;
            return (
              <li key={r.version}>
                <a className={"version-item" + (r.published ? " is-live" : "")} href={`#app/${app.slug}/${r.version}`} aria-current={!creating && current?.version === r.version ? "page" : undefined}>
                  <span className="dot" aria-hidden="true" />
                  <span className="v">{r.version}</span>
                  <span className="when">{fmtShort(r.date)}</span>
                  <span className="meta">
                    {r.published ? <>▲{r.up} · {n} 💬</> : <b className="tag">Draft</b>}
                    {r.source === "app_store" && <b className="tag">App Store</b>}
                  </span>
                </a>
              </li>
            );
          })}
        </ol>
      </nav>
      <section className="editor" aria-label="Version">
        {creating ? <NewVersion app={app} first={!releases.length} go={go} flash={flash} /> : current && <VersionEditor key={current.id} app={app} r={current} go={go} flash={flash} preview={preview} />}
      </section>
      <aside className="feed" aria-label="Feedback">
        <Feed rows={rows} bugs={bugs} flash={flash} go={go} title="Feedback" />
      </aside>
    </div>
  );
}

function NewVersion({ app, first, go, flash }: { app: App; first: boolean; go: Go; flash: Flash }) {
  const [f, setF] = useState({ version: "", notes: "", date: today(), published: true });
  const [err, setErr] = useState("");
  return (
    <form className="dash-form editor-form" onSubmit={async (e) => {
      e.preventDefault();
      const version = f.version.trim();
      if (!/^\d+(\.\d+){0,3}$/.test(version)) return setErr("Use a version number like 4.1 or 4.1.2.");
      if (!f.notes.trim()) return setErr("Add some release notes.");
      const e2 = await addRelease(app.slug, { ...f, version, notes: f.notes.trim() });
      if (e2) return setErr(e2);
      flash(f.published ? `Version ${version} published` : `Version ${version} saved as draft`);
      go("app", app.slug, version);
    }}>
      <h1 className="page-title">{first ? "Your first version" : "New version"}</h1>
      <p>Write what changed, or paste the notes you sent to the App Store. {first && <>To import them automatically, connect App Store Connect in <a className="made-by" href={`#settings/${app.slug}`}>Settings</a>.</>}</p>
      <div className="row">
        <label style={{ flex: 1 }}>Version<input value={f.version} onChange={(e) => setF({ ...f, version: e.target.value })} placeholder="4.1" /></label>
        <label style={{ flex: 1 }}>Release date<input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} required /></label>
      </div>
      <label>Release notes<textarea className="notes-input" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder={"What's new in this version\n\n- …"} /></label>
      <label className="row" style={{ display: "flex" }}><input type="checkbox" checked={f.published} onChange={(e) => setF({ ...f, published: e.target.checked })} />Publish now</label>
      {err && <p className="form-error" role="alert">{err}</p>}
      <div className="row"><button className="button" type="submit">Add version</button></div>
    </form>
  );
}

// Languages people can add translated notes for. The app shows the one matching the phone's language.
const LANGS = ["de", "es", "fr", "it", "ja", "ko", "nl", "pl", "pt", "sv", "tr", "zh"];
const langName = (code: string) => new Intl.DisplayNames(["en"], { type: "language" }).of(code) || code;

function VersionEditor({ app, r, go, flash, preview }: { app: App; r: Release; go: Go; flash: Flash; preview: (r: Release) => void }) {
  const [notes, setNotes] = useState(r.notes);
  const [date, setDate] = useState(r.date);
  const [tr, setTr] = useState<Record<string, string>>(r.translations);
  const dirty = notes !== r.notes || date !== r.date || JSON.stringify(tr) !== JSON.stringify(r.translations);
  const unused = LANGS.filter((l) => !(l in tr));
  const n = visibleComments(r).length;
  return (
    <div className="editor-form">
      <div className="editor-head">
        <h1 className="page-title"><span className="v">v{r.version}</span> <b className={"tag" + (r.published ? " accent" : "")}>{r.published ? "Live" : "Draft"}</b>{r.source === "app_store" && <b className="tag">App Store</b>}</h1>
        <div className="row">
          <button className="chip" onClick={() => preview(r)}>Preview What&apos;s new</button>
          {r.published && <a className="chip" href={changelogHref(app, r.version)} target="_blank" rel="noreferrer">Public page ↗</a>}
          <button className="chip solid" onClick={async () => { if (!(await updateRelease(app.slug, r.version, { published: !r.published }))) flash(r.published ? "Moved to drafts" : "Published"); }}>{r.published ? "Unpublish" : "Publish"}</button>
        </div>
      </div>
      <p className="reactions-line"><span>👍 {r.up}</span><span>👎 {r.down}</span><span>{n} {n === 1 ? "comment" : "comments"}</span><span>{r.comments.filter((c) => c.hidden).length} hidden</span></p>
      <form className="dash-form" onSubmit={async (e) => { e.preventDefault(); const translations = Object.fromEntries(Object.entries(tr).filter(([, t]) => t.trim()));
          if (!(await updateRelease(app.slug, r.version, { notes, date, translations }))) { setTr(translations); flash("Saved"); } }}>
        <label>Release date<input type="date" value={date} onChange={(e) => setDate(e.target.value)} required /></label>
        <label>Notes<textarea className="notes-input" value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
        {Object.keys(tr).sort().map((l) => (
          <div key={l} className="translation">
            <label>Notes in {langName(l)}<textarea className="notes-input is-short" lang={l} value={tr[l]} onChange={(e) => setTr({ ...tr, [l]: e.target.value })} /></label>
            <button type="button" className="text-btn" onClick={() => { const { [l]: _gone, ...rest } = tr; setTr(rest); }}>Remove {langName(l)}</button>
          </div>
        ))}
        {unused.length > 0 && (
          <label className="add-language">Add a translation
            <select value="" onChange={(e) => e.target.value && setTr({ ...tr, [e.target.value]: "" })}>
              <option value="">Choose a language…</option>
              {unused.map((l) => <option key={l} value={l}>{langName(l)}</option>)}
            </select>
          </label>
        )}
        <div className="row">
          <button className="button" type="submit" disabled={!dirty}>Save</button>
          {dirty && <button type="button" className="button button-quiet" onClick={() => { setNotes(r.notes); setDate(r.date); setTr(r.translations); }}>Discard changes</button>}
          <span className="spacer" />
          <button type="button" className="button button-danger" onClick={async () => { if (confirm(`Delete version ${r.version} and its comments?`) && !(await deleteRelease(app.slug, r.version))) go("app", app.slug); }}>Delete version</button>
        </div>
      </form>
    </div>
  );
}

// ---------- feedback ----------
function Inbox({ rows, bugs, filter, go, flash }: { rows: FeedRow[]; bugs: BugRow[]; filter: Filter; go: Go; flash: Flash }) {
  return (
    <div className="page-inbox">
      <Feed key={filter} rows={rows} bugs={bugs} flash={flash} go={go} title="Inbox" showApp initialFilter={filter} />
    </div>
  );
}

const EMPTY: Record<Filter, string> = {
  all: "No feedback yet. It appears here the moment someone reacts to an update.",
  reports: "Nothing reported. All quiet.",
  bugs: "No bug reports. People can send one, with a screenshot, from inside your app.",
};

function Feed({ rows, bugs, flash, go, title, showApp, initialFilter = "all" }: { rows: FeedRow[]; bugs: BugRow[]; flash: Flash; go: Go; title: string; showApp?: boolean; initialFilter?: Filter }) {
  const [filter, setFilter] = useState<Filter>(initialFilter);
  const reported = rows.filter((x) => x.c.reports.length);
  const open = bugs.filter((x) => !x.b.resolved).length;
  const H = showApp ? "h1" : "h2"; // the inbox is its own page
  const roots = (filter === "reports" ? reported : rows.filter((x) => !x.c.parent)).sort((a, b) => b.c.date.localeCompare(a.c.date));
  const tab = (f: Filter, label: string, n: number) => (
    <button type="button" aria-pressed={filter === f} onClick={() => setFilter(f)}>{label}{n > 0 && <b className="count-badge">{n}</b>}</button>
  );
  const empty = filter === "bugs" ? !bugs.length : !roots.length;
  return (
    <div className="feed-inner">
      <div className="feed-head">
        <H>{title} <span className="live-dot" title="Updates live" /></H>
        <div className="tabs" role="group" aria-label="Show">
          {tab("all", "All", 0)}{tab("reports", "Reports", reported.length)}{tab("bugs", "Bugs", open)}
        </div>
      </div>
      {empty ? (
        <p className="empty-state">{EMPTY[filter]}</p>
      ) : filter === "bugs" ? (
        <ol className="feed-list">
          {bugs.map(({ app, b }) => <li key={b.id}><BugItem app={app} b={b} flash={flash} go={go} showApp={showApp} /></li>)}
        </ol>
      ) : (
        <ol className="feed-list">
          {roots.map(({ app, rel, c }) => <li key={c.id}><FeedItem app={app} rel={rel} c={c} flash={flash} go={go} showApp={showApp} /></li>)}
        </ol>
      )}
    </div>
  );
}

function BugItem({ app, b, flash, go, showApp }: BugRow & { flash: Flash; go: Go; showApp?: boolean }) {
  const [shot, setShot] = useState<string | null>(null);
  return (
    <article className={"feed-item bug-item" + (b.resolved ? " is-resolved" : "")}>
      <header className="meta">
        <span className="avatar" aria-hidden="true">🐞</span>
        <strong>{b.author}</strong>
        <a className="tag" href={`#app/${app.slug}`} onClick={() => go("app", app.slug)}>{showApp ? `${shortName(app)} ` : ""}v{b.version}</a>
        <time>{fmtShort(b.date.slice(0, 10))}</time>
      </header>
      <p>{b.text}</p>
      {(b.device || b.resolved) && <div className="meta">{b.device && <span>{b.device}</span>}{b.resolved && <span>Fixed</span>}</div>}
      {shot && <a href={shot} target="_blank" rel="noreferrer"><img className="bug-shot" src={shot} alt={`Screenshot sent with the bug report from ${b.author}`} /></a>}
      <div className="actions">
        {b.screenshot && !shot && <button className="button button-quiet" onClick={async () => { const url = await screenshotUrl(b.screenshot!); if (url) setShot(url); else flash("Screenshot not found"); }}>Show screenshot</button>}
        <button className="button button-quiet" onClick={async () => { if (!(await setBugResolved(b.id, !b.resolved))) flash(b.resolved ? "Reopened" : "Marked as fixed"); }}>{b.resolved ? "Reopen" : "Mark as fixed"}</button>
        <button className="button button-quiet" onClick={async () => { if (confirm("Delete this bug report and its screenshot?") && !(await deleteBug(b))) flash("Bug report deleted"); }}>Delete</button>
      </div>
    </article>
  );
}

function FeedItem({ app, rel, c, flash, go, showApp }: FeedRow & { flash: Flash; go: Go; showApp?: boolean }) {
  const [reply, setReply] = useState("");
  const [open, setOpen] = useState(false);
  const replies = rel.comments.filter((x) => x.parent === c.id && !x.deleted);
  return (
    <article className={"feed-item mod-item" + (c.hidden ? " hidden-c" : "") + (c.dev ? " is-dev" : "")}>
      <header className="meta">
        <span className="avatar" aria-hidden="true">{c.author.slice(0, 1)}</span>
        <strong>{c.author}{c.dev && <span className="badge-dev">Developer</span>}</strong>
        <a className="tag" href={`#app/${app.slug}/${rel.version}`} onClick={() => go("app", app.slug, rel.version)}>{showApp ? `${shortName(app)} ` : ""}v{rel.version}</a>
        <time>{fmtShort(c.date.slice(0, 10))}</time>
      </header>
      <p>{c.text}</p>
      <div className="meta">
        <span>▲ {c.up} ▼ {c.down}</span>
        {c.reports.length > 0 && <span className="reported">{c.reports.length} report{c.reports.length > 1 ? "s" : ""}: {[...new Set(c.reports.map((r) => r.reason))].join(", ")}</span>}
        {c.hidden && <span>Hidden</span>}
      </div>
      <div className="actions">
        {!c.parent && <button className="button button-quiet" onClick={() => setOpen(!open)}>Reply as developer</button>}
        <button className="button button-quiet" onClick={() => { setHidden(c.id, !c.hidden); flash(c.hidden ? "Comment visible again" : "Comment hidden"); }}>{c.hidden ? "Unhide" : "Hide"}</button>
        {c.reports.length > 0 && <button className="button button-quiet" onClick={() => { dismissReports(c.id); flash("Reports dismissed"); }}>Dismiss reports</button>}
      </div>
      {open && (
        <form className="dash-form" onSubmit={async (e) => { e.preventDefault(); if (!reply.trim()) return; if (await addComment(app.slug, rel.version, reply, c.id)) return; setReply(""); setOpen(false); flash("Reply posted"); }}>
          <textarea value={reply} onChange={(e) => setReply(e.target.value)} placeholder={`Reply to ${c.author}…`} style={{ minHeight: 70 }} autoFocus />
          <div className="row"><button className="button" type="submit">Post reply</button><button type="button" className="button button-quiet" onClick={() => setOpen(false)}>Cancel</button></div>
        </form>
      )}
      {replies.length > 0 && (
        <ol className="feed-replies">
          {replies.map((r) => <li key={r.id}><FeedItem app={app} rel={rel} c={r} flash={flash} go={go} /></li>)}
        </ol>
      )}
    </article>
  );
}

// ---------- settings ----------
function Settings({ app, asc, play, go, flash }: { app: App; asc: AscConnection | null; play: { clientEmail: string } | null; go: Go; flash: Flash }) {
  return (
    <>
      <div className="panel">
        <h1 className="page-title">App details</h1>
        <AppForm key={app.id} initial={{ name: app.name, description: app.description, storeUrl: app.storeUrl, contact: app.contact, color: app.color }} submitLabel="Save changes"
          onSubmit={async (v) => { if (!(await updateApp(app.slug, v))) flash("Saved"); }} />
      </div>
      <WebhookPanel key={app.id + (app.webhookUrl || "")} app={app} flash={flash} />
      <AscAppPanel app={app} asc={asc} go={go} flash={flash} />
      <ProofsPanel key={app.id + app.proofMode} app={app} play={play} go={go} flash={flash} />
      <div className="panel danger-zone">
        <h2>Remove app</h2>
        <p>Deletes {app.name}, its versions and all feedback. The public changelog stops working.</p>
        <div className="row"><button className="button button-danger" onClick={async () => { if (confirm(`Remove ${app.name} and all its releases?`) && !(await deleteApp(app.slug))) go(""); }}>Remove app</button></div>
      </div>
    </>
  );
}

function WebhookPanel({ app, flash }: { app: App; flash: Flash }) {
  const [url, setUrl] = useState(app.webhookUrl || "");
  const [err, setErr] = useState("");
  return (
    <div className="panel">
      <h2>Notifications</h2>
      <p>Get every new comment, report and bug report in Slack, Discord, Telegram or your own endpoint, the moment it arrives. Paste an incoming webhook address.</p>
      <form className="dash-form" onSubmit={async (e) => { e.preventDefault(); const er = await setWebhook(app.slug, url); setErr(er || ""); if (!er) flash(url.trim() ? "Webhook saved" : "Webhook removed"); }}>
        <label>Webhook address<input type="url" inputMode="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://hooks.slack.com/services/…" /></label>
        {err && <p className="form-error" role="alert">{err}</p>}
        <div className="row">
          <button className="button" type="submit" disabled={url.trim() === (app.webhookUrl || "")}>Save</button>
          {app.webhookUrl && <button type="button" className="button button-quiet" onClick={async () => { const er = await testWebhook(app.slug); setErr(er || ""); if (!er) flash("Test message sent"); }}>Send a test</button>}
        </div>
      </form>
    </div>
  );
}

// Preview of the in-app sheet, in the new half-sheet design.
function WhatsNew({ app, r, onClose }: Sheet & { onClose: () => void }) {
  const [chat, setChat] = useState(false);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  }, [onClose]);
  const all = visibleComments(r);
  const messages: ChatMessage[] = all.filter((c) => !c.parent).slice(0, 4).map((c) => ({
    id: c.id, author: c.author, text: c.text, dev: c.dev,
    replies: all.filter((x) => x.parent === c.id).map((x) => ({ id: x.id, author: x.author, text: x.text, dev: x.dev })),
  }));
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="app-sheet" role="dialog" aria-modal="true" aria-label="What's new preview" onClick={(e) => e.stopPropagation()}>
        {chat ? (
          <div className="as-body">
            <div className="as-grabber" aria-hidden="true" />
            <div className="as-title"><button className="text-btn" onClick={() => setChat(false)}>‹ {r.version}</button><h2>{all.length === 1 ? "1 comment" : `${all.length} comments`}</h2><button className="text-btn" onClick={onClose}>Close</button></div>
            <ChatThread messages={messages} />
          </div>
        ) : (
          <SheetBody release={{ version: r.version, date: r.date, notes: r.notes, up: r.up, down: r.down, mine: 0, comments: visibleComments(r).length }} badge="Installed" onFeedback={() => setChat(true)} onClose={onClose} />
        )}
        <p className="as-caption">This is how {shortName(app)} shows the update inside the app. <button className="text-btn" onClick={onClose}>Close</button></p>
      </div>
    </div>
  );
}

export const RN_PACKAGE = "/sdk/changelark-react-native-0.1.0.tgz";


function SdkView({ app, go }: { app: App; go: Go }) {
  const [platform, setPlatform] = useState<"rn" | "swift">("swift");
  // Snippets point at this server, so self-hosted instances work without edits.
  const origin = typeof location === "undefined" ? "" : location.origin;
  const swift = `import SwiftUI\nimport Changelark\n\n@main\nstruct MyApp: App {\n    init() {\n        Changelark.configure(\n            appKey: "${app.key}",\n            baseURL: URL(string: "${origin}")!\n        )\n    }\n\n    var body: some Scene {\n        WindowGroup {\n            ContentView().changelarkWhatsNew()\n        }\n    }\n}`;
  const rnInstall = "npm install changelark-react-native @react-native-async-storage/async-storage expo-application";
  const rn = `import { ChangelarkProvider } from "changelark-react-native";\n\nexport default function App() {\n  return (\n    <ChangelarkProvider appKey="${app.key}" baseUrl="${origin}">\n      <RootNavigator />\n    </ChangelarkProvider>\n  );\n}`;
  return (
    <>
      <h1 className="page-title">Install the SDK</h1>
      <div className="panel">
        <div className="plan-toggle sdk-tabs" role="group" aria-label="Platform">
          <button type="button" aria-pressed={platform === "swift"} onClick={() => setPlatform("swift")}>Swift (iOS)</button>
          <button type="button" aria-pressed={platform === "rn"} onClick={() => setPlatform("rn")}>React Native</button>
        </div>
        <h2>1. Your public app key</h2>
        <p>Safe to ship inside your app. It only identifies the app; it can&apos;t log anyone into this dashboard.</p>
        <div className="key">{app.key}</div>
      </div>
      <div className="panel">
        <h2>Is it safe to put this key in my app?</h2>
        <p>Yes. It&apos;s a public key, like a web address: anyone can read it out of an app, so it gives no special powers.</p>
        <ul className="safe-list">
          <li><b>It can:</b> load this app&apos;s published release notes, and let people vote and comment anonymously.</li>
          <li><b>It can&apos;t:</b> log in here, change or delete releases, see private data, or moderate. That needs your account, which never ships in the app.</li>
          <li><b>If someone copies it to spam:</b> hide and report tools catch it, each install can post 5 comments a minute and each network 30. For more, turn on <b>App proofs</b> on the app&apos;s page: then only genuine copies of your app can post.</li>
          <li><b>Never</b> put a password or secret key in an app. The package refuses any key that doesn&apos;t start with clk_.</li>
        </ul>
        <button className="button button-quiet" type="button" onClick={() => {
          if (confirm("Make a new key? Apps that still use the old key will stop loading notes and comments until you ship an update with the new one.")) rotateKey(app.slug);
        }}>Make a new key</button>
      </div>
      {platform === "swift" ? (
        <>
          <div className="panel">
            <h2>2. Add the Swift package</h2>
            <p>In Xcode, choose File → Add Package Dependencies and enter <span className="mono">{SWIFT_PACKAGE_URL}</span>. iOS 16 or later, no other dependencies.</p>
          </div>
          <div className="panel">
            <h2>3. Configure it and attach What&apos;s new</h2>
            <p>The sheet appears by itself after an update. Add <span className="mono">useAppAttest: true</span> to sign votes and comments with App Attest. <a className="made-by" href="/docs/swift">Swift guide</a></p>
            <CopyCode code={swift} />
          </div>
        </>
      ) : (
        <>
          <div className="panel">
            <h2>2. Install the React Native package</h2>
            <p>Works on iOS and Android, with Expo or bare React Native. <a className="made-by" href={RN_PACKAGE} download>Download the package</a> or install it from npm:</p>
            <CopyCode code={rnInstall} />
          </div>
          <div className="panel">
            <h2>3. Wrap your app once</h2>
            <p>The provider decides on each launch whether to show What&apos;s new, and remembers what was shown on the device.</p>
            <CopyCode code={rn} />
          </div>
        </>
      )}
      <div className="panel">
        <h2>{platform === "swift" ? "3" : "4"}. Ship an update</h2>
        <p>The first time someone opens a new version, they see its notes in a sheet and react and write back, no sign-up needed. <button className="chip" type="button" onClick={() => go("preview", app.slug)}>See it in Preview</button></p>
      </div>
    </>
  );
}

// Account details and the irreversible delete, confirmed by typing the email.
function AccountView({ me, apps, asc, play, emailAlerts, smtpConfigured, flash }: { me: { name: string; email: string }; apps: App[]; asc: AscConnection | null; play: { clientEmail: string } | null; emailAlerts: boolean; smtpConfigured: boolean; flash: Flash }) {
  const [confirmText, setConfirmText] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const isDemo = me.email === DEMO.email;
  const releases = apps.reduce((n, a) => n + a.releases.length, 0);
  const comments = apps.reduce((n, a) => n + a.releases.reduce((m, r) => m + r.comments.length, 0), 0);
  const matches = confirmText.trim().toLowerCase() === me.email.toLowerCase();
  return (
    <>
      <h1 className="page-title">Account</h1>
      <div className="panel">
        <h2>Signed in as</h2>
        <p><b style={{ color: "var(--text)" }}>{me.name}</b> · <span className="mono">{me.email}</span></p>
      </div>
      {isDemo ? (
        <div className="panel"><h2>App Store Connect</h2><p>Not available in the shared demo. <a className="made-by" href="/signup">Create your own account</a> to import versions from App Store Connect.</p></div>
      ) : <><ProfilePanel me={me} flash={flash} />
        {smtpConfigured && <AlertsPanel initial={emailAlerts} email={me.email} flash={flash} />}<AscKeyPanel asc={asc} flash={flash} /><PlayKeyPanel play={play} flash={flash} /></>}
      <div className="panel danger-zone">
        <h2>Delete account</h2>
        {isDemo ? (
          <p>The shared demo account can&apos;t be deleted. Use <b>Reset demo</b> to put it back the way it started.</p>
        ) : (
          <>
            <p>This permanently deletes your account, {apps.length} app{apps.length === 1 ? "" : "s"}, {releases} release{releases === 1 ? "" : "s"} and {comments} comment{comments === 1 ? "" : "s"}, with their votes and reports. Public changelog pages stop working and in-app keys stop loading notes. It can&apos;t be undone.</p>
            <form className="dash-form" onSubmit={async (e) => {
              e.preventDefault();
              if (!matches) return;
              setBusy(true);
              let error: string | null;
              try { error = await deleteAccount(confirmText); }
              catch { error = NETWORK_ERROR; }
              finally { setBusy(false); }
              if (error) return setErr(error);
              location.href = "/login?deleted=1";
            }}>
              <label>Type <span className="mono">{me.email}</span> to confirm<input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} autoComplete="off" spellCheck={false} /></label>
              {err && <p className="form-error" role="alert">{err}</p>}
              <div className="row"><button className="button button-danger" type="submit" disabled={!matches || busy}>Delete my account</button></div>
            </form>
          </>
        )}
      </div>
    </>
  );
}

// Shown when a store call throws (network failure) instead of returning its own error.
const NETWORK_ERROR = "Something went wrong. Check your connection and try again.";
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
const syncSummary = (r: { imported: number; published: number }) =>
  r.imported || r.published ? `Imported ${plural(r.imported, "version")}, published ${r.published}` : "Already up to date";

// Account: store the App Store Connect API key. The server checks it with Apple, then keeps the .p8 in Supabase Vault.
function AscKeyPanel({ asc, flash }: { asc: AscConnection | null; flash: Flash }) {
  const [f, setF] = useState({ issuerId: "", keyId: "", privateKey: "" });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  if (asc) {
    return (
      <div className="panel">
        <h2>App Store Connect</h2>
        <p>Connected with key <span className="mono">{asc.keyId}</span>. {asc.lastSyncAt ? `Last import ${fmtShort(asc.lastSyncAt.slice(0, 10))}.` : "Link an app to import its versions."}</p>
        {asc.lastError && <p className="form-error" role="alert">Last import failed: {asc.lastError}</p>}
        <div className="row"><button className="button button-quiet" type="button" onClick={async () => {
          if (!confirm("Disconnect App Store Connect? The stored key is deleted and apps stop importing. Imported releases stay.")) return;
          const e = await ascDisconnect(); if (e) alert(e); else flash("Disconnected");
        }}>Disconnect</button></div>
      </div>
    );
  }
  return (
    <div className="panel">
      <h2>App Store Connect</h2>
      <p>Import versions and their What&apos;s New text automatically. In App Store Connect, open Users and Access → Integrations → App Store Connect API, create a key with the App Manager role and download the .p8 file.</p>
      <form className="dash-form" onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        let error: string | null;
        try { error = await ascConnect(f.issuerId, f.keyId, f.privateKey); }
        catch { error = NETWORK_ERROR; }
        finally { setBusy(false); }
        if (error) return setErr(error);
        setErr(""); flash("App Store Connect connected");
      }}>
        <div className="row">
          <label style={{ flex: 2 }}>Issuer ID<input value={f.issuerId} onChange={(e) => setF({ ...f, issuerId: e.target.value })} placeholder="57246542-96fe-1a63-e053-0824d011072a" autoComplete="off" spellCheck={false} required /></label>
          <label style={{ flex: 1 }}>Key ID<input value={f.keyId} onChange={(e) => setF({ ...f, keyId: e.target.value })} placeholder="2X9R4HXF34" autoComplete="off" spellCheck={false} required /></label>
        </div>
        <label>Private key (.p8)
          <input type="file" accept=".p8" onChange={async (e) => { const file = e.target.files?.[0]; if (file) setF({ ...f, privateKey: (await file.text()).trim() }); }} />
        </label>
        <label>Or paste it<textarea value={f.privateKey} onChange={(e) => setF({ ...f, privateKey: e.target.value })} placeholder={"-----BEGIN PRIVATE KEY-----\n…\n-----END PRIVATE KEY-----"} spellCheck={false} style={{ fontFamily: "var(--font-mono-stack)", fontSize: "0.8125rem", minHeight: 100 }} /></label>
        {err && <p className="form-error" role="alert">{err}</p>}
        <div className="row"><button className="button" type="submit" disabled={busy}>{busy ? "Checking with Apple…" : "Connect"}</button></div>
      </form>
    </div>
  );
}

// App: choose which App Store app this one imports from, then sync on demand.
function AscAppPanel({ app, asc, go, flash }: { app: App; asc: AscConnection | null; go: Go; flash: Flash }) {
  const [choices, setChoices] = useState<AscApp[] | null>(null);
  const [pick, setPick] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<{ data?: { imported: number; published: number }; error?: string }>) => {
    setBusy(true); setErr("");
    let r: Awaited<ReturnType<typeof fn>>;
    try { r = await fn(); }
    catch { r = { error: NETWORK_ERROR }; }
    finally { setBusy(false); }
    if (r.error) setErr(r.error); else if (r.data) flash(syncSummary(r.data));
  };
  if (!asc) {
    return (
      <div className="panel">
        <h2>App Store Connect</h2>
        <p>Import versions and release notes automatically instead of typing them.</p>
        <div className="row"><button className="button button-quiet" type="button" onClick={() => go("account")}>Connect in Account</button></div>
      </div>
    );
  }
  if (app.ascAppId) {
    return (
      <div className="panel">
        <h2>App Store Connect</h2>
        <p>Imports from App Store app <span className="mono">{app.ascAppId}</span>. New versions arrive as drafts and are published when they go live.</p>
        {err && <p className="form-error" role="alert">{err}</p>}
        <div className="row">
          <button className="button button-quiet" type="button" disabled={busy} onClick={() => run(() => ascSync(app.slug))}>{busy ? "Importing…" : "Sync now"}</button>
          <button className="button button-quiet" type="button" disabled={busy} onClick={async () => { await ascLink(app.slug, null); flash("Unlinked"); }}>Unlink</button>
        </div>
      </div>
    );
  }
  return (
    <div className="panel">
      <h2>App Store Connect</h2>
      <p>Choose the App Store app this changelog belongs to. Its versions are imported right away.</p>
      {choices === null ? (
        <div className="row"><button className="button button-quiet" type="button" disabled={busy} onClick={async () => {
          setBusy(true);
          let r: Awaited<ReturnType<typeof ascApps>>;
          try { r = await ascApps(); }
          catch { r = { error: NETWORK_ERROR }; }
          finally { setBusy(false); }
          if (r.error) setErr(r.error); else { setChoices(r.data!.apps); setPick(r.data!.apps[0]?.id || ""); }
        }}>{busy ? "Loading…" : "Choose an App Store app"}</button></div>
      ) : choices.length === 0 ? (
        <p>Your key can&apos;t see any apps yet.</p>
      ) : (
        <form className="dash-form" onSubmit={(e) => { e.preventDefault(); run(() => ascLink(app.slug, pick)); }}>
          <label>App Store app
            <select value={pick} onChange={(e) => setPick(e.target.value)}>
              {choices.map((c) => <option key={c.id} value={c.id}>{c.name} · {c.bundleId}</option>)}
            </select>
          </label>
          <div className="row"><button className="button" type="submit" disabled={busy || !pick}>{busy ? "Importing…" : "Link and import"}</button></div>
        </form>
      )}
      {err && <p className="form-error" role="alert">{err}</p>}
    </div>
  );
}

// Account: Google service account for decoding Play Integrity tokens (kept in Supabase Vault, like the App Store key).
function PlayKeyPanel({ play, flash }: { play: { clientEmail: string } | null; flash: Flash }) {
  const [text, setText] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  if (play) {
    return (
      <div className="panel">
        <h2>Google Play Integrity</h2>
        <p>Connected with <span className="mono">{play.clientEmail}</span>. Android apps that require app proofs are checked with this account.</p>
        <div className="row"><button className="button button-quiet" type="button" onClick={async () => {
          if (!confirm("Disconnect Google Play Integrity? Android apps that require proofs will reject every vote and comment until you connect again.")) return;
          const e = await playDisconnect(); if (e) alert(e); else flash("Disconnected");
        }}>Disconnect</button></div>
      </div>
    );
  }
  return (
    <div className="panel">
      <h2>Google Play Integrity</h2>
      <p>Needed only for Android apps that require app proofs. In the Google Cloud project linked to your app in Play Console, create a service account, enable the Play Integrity API and download a JSON key.</p>
      <form className="dash-form" onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        let error: string | null;
        try { error = await playConnect(text); }
        catch { error = NETWORK_ERROR; }
        finally { setBusy(false); }
        if (error) return setErr(error);
        setErr(""); setText(""); flash("Google Play Integrity connected");
      }}>
        <label>Service account key (.json)<input type="file" accept=".json,application/json" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setText(await f.text()); }} /></label>
        {err && <p className="form-error" role="alert">{err}</p>}
        <div className="row"><button className="button" type="submit" disabled={busy || !text}>{busy ? "Checking with Google…" : "Connect Google Play"}</button></div>
      </form>
    </div>
  );
}

// App: require proof that votes and comments come from the genuine app (App Attest on iOS, Play Integrity on Android).
function ProofsPanel({ app, play, go, flash }: { app: App; play: { clientEmail: string } | null; go: Go; flash: Flash }) {
  const [f, setF] = useState({ proofMode: app.proofMode, iosAppId: app.iosAppId || "", iosAttestEnv: app.iosAttestEnv, androidPackage: app.androidPackage || "" });
  const [err, setErr] = useState("");
  const on = f.proofMode === "required";
  return (
    <div className="panel">
      <h2>App proofs</h2>
      <p>Only genuine copies of your app can vote, comment and report. The public changelog and the pretend phone become read-only for this app, because a browser can&apos;t prove it&apos;s your app.</p>
      <form className="dash-form" onSubmit={async (e) => {
        e.preventDefault();
        if (on && !f.iosAppId.trim() && !f.androidPackage.trim()) return setErr("Add an iOS App ID or an Android package first.");
        const error = await updateProofs(app.slug, f);
        if (error) return setErr(error);
        setErr(""); flash(on ? "App proofs required" : "App proofs saved");
      }}>
        <label className="row" style={{ display: "flex" }}><input type="checkbox" checked={on} onChange={(e) => setF({ ...f, proofMode: e.target.checked ? "required" : "off" })} />Require app proofs</label>
        <div className="row">
          <label style={{ flex: 2 }}>iOS App ID<input value={f.iosAppId} onChange={(e) => setF({ ...f, iosAppId: e.target.value })} placeholder="ABCDE12345.com.example.app" spellCheck={false} /></label>
          <label style={{ flex: 1 }}>App Attest environment
            <select value={f.iosAttestEnv} onChange={(e) => setF({ ...f, iosAttestEnv: e.target.value as App["iosAttestEnv"] })}>
              <option value="production">Production</option>
              <option value="development">Development</option>
            </select>
          </label>
        </div>
        <label>Android package<input value={f.androidPackage} onChange={(e) => setF({ ...f, androidPackage: e.target.value })} placeholder="com.example.app" spellCheck={false} /></label>
        {f.androidPackage.trim() && !play && <p>Android proofs also need <button type="button" className="text-btn" style={{ padding: 0, color: "var(--accent-text)" }} onClick={() => go("account")}>Google Play Integrity in Account</button>.</p>}
        {err && <p className="form-error" role="alert">{err}</p>}
        <div className="row"><button className="button" type="submit">Save</button></div>
      </form>
    </div>
  );
}

// Account: name, email and password.
function ProfilePanel({ me, flash }: { me: { name: string; email: string }; flash: Flash }) {
  const [name, setName] = useState(me.name);
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState({ current: "", next: "" });
  const [msg, setMsg] = useState<{ part: string; error?: string; ok?: string } | null>(null);
  const show = (part: string, error: string | null, ok: string) => error ? setMsg({ part, error }) : (setMsg({ part, ok }), flash(ok));
  const note = (part: string) => msg?.part === part && (msg.error ? <p className="form-error" role="alert">{msg.error}</p> : <p role="status">{msg.ok}</p>);
  return (
    <div className="panel">
      <h2>Profile</h2>
      <form className="dash-form" onSubmit={async (e) => { e.preventDefault(); show("name", await updateName(name), "Name saved"); }}>
        <label>Name<input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required /></label>
        <p>Shown next to your replies. Replies you already posted keep the old name.</p>
        {note("name")}
        <div className="row"><button className="button button-quiet" type="submit" disabled={!name.trim() || name.trim() === me.name}>Save name</button></div>
      </form>
      <form className="dash-form" onSubmit={async (e) => { e.preventDefault(); const err = await changeEmail(email); show("email", err, "Check both inboxes to confirm the change"); if (!err) setEmail(""); }}>
        <label>New email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={me.email} autoComplete="email" required /></label>
        {note("email")}
        <div className="row"><button className="button button-quiet" type="submit" disabled={!email.trim()}>Change email</button></div>
      </form>
      <form className="dash-form" onSubmit={async (e) => { e.preventDefault(); const err = await changePassword(pw.current, pw.next); show("password", err, "Password changed"); if (!err) setPw({ current: "", next: "" }); }}>
        <div className="row">
          <label style={{ flex: 1 }}>Current password<input type="password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} autoComplete="current-password" required /></label>
          <label style={{ flex: 1 }}>New password<input type="password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} autoComplete="new-password" minLength={8} required /></label>
        </div>
        {note("password")}
        <div className="row"><button className="button button-quiet" type="submit" disabled={!pw.current || pw.next.length < 8}>Change password</button></div>
      </form>
    </div>
  );
}

// Account: daily digest on or off. The box flips at once and flips back if saving fails.
function AlertsPanel({ initial, email, flash }: { initial: boolean; email: string; flash: Flash }) {
  const [on, setOn] = useState(initial);
  return (
    <div className="panel">
      <h2>Email alerts</h2>
      <label className="row" style={{ display: "flex", fontWeight: 400 }}>
        <input type="checkbox" checked={on} onChange={async (e) => {
          const next = e.target.checked;
          setOn(next);
          const err = await setEmailAlerts(next);
          if (err) { setOn(!next); alert(err); } else flash(next ? "Email alerts on" : "Email alerts off");
        }} />
        Email me a summary of new comments and reports
      </label>
      <p>At most once a day, only when something new arrived, sent to {email}.</p>
    </div>
  );
}
