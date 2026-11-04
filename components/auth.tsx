"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Brand } from "./icons";
import { ThemeSwitch } from "./widgets";
import { login, signup, enterDemo, requestPasswordReset, updatePassword, CHECK_EMAIL } from "../lib/store";

type Mode = "login" | "signup" | "forgot" | "reset";

const COPY: Record<Mode, { title: React.ReactNode; lead: string; button: string }> = {
  login: { title: "Back to your inbox.", lead: "Your users may have written since last time.", button: "Log in" },
  signup: { title: <>Release notes<br />people answer.</>, lead: "One account for all your apps. Free and open source.", button: "Create account" },
  forgot: { title: "Lost it?", lead: "Enter your email and we'll send you a reset link.", button: "Email me a link" },
  reset: { title: "Pick a new password.", lead: "At least 8 characters.", button: "Save password" },
};

// Made-up feedback for the decorative panel next to the form.
const SAMPLE = [
  ["Juniper-4C2F", "Tidepool v2.4", "The swell graph is exactly what I check before paddling out."],
  ["Alder-7A1B", "Ledgerly v1.2", "Splitting a bill finally takes one tap. Thank you!"],
  ["Rowan-09E3", "Nightjar v3.0", "The new rain recording knocks me out in minutes."],
];

export default function AuthPage({ mode, demo = false }: { mode: Mode; demo?: boolean }) {
  const [f, setF] = useState({ name: "", email: "", password: "" });
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  type Creds = typeof f;
  const set = (k: keyof Creds) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const needs = { name: mode === "signup", email: mode !== "reset", password: mode !== "forgot" };
  const ready = (!needs.name || f.name) && (!needs.email || f.email) && (!needs.password || f.password);
  const c = COPY[mode];

  // /auth/confirm sends people back here when an email link is old or already used.
  useEffect(() => {
    const q = new URLSearchParams(location.search);
    if (q.get("error") === "link") setError("That link is invalid or has expired. Ask for a new one.");
    if (q.get("deleted") === "1") setNotice("Your account and everything in it were deleted.");
  }, []);

  async function run(action: () => Promise<string | null>, onDone: () => void) {
    setBusy(true); setError(""); setNotice("");
    let err: string | null;
    try { err = await action(); }
    catch { err = "Something went wrong. Check your connection and try again."; }
    finally { setBusy(false); }
    if (err === CHECK_EMAIL) return setNotice(err);
    if (err) return setError(err);
    onDone();
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (mode === "signup") run(() => signup(f.name, f.email, f.password), () => { location.href = "/"; });
    else if (mode === "login") run(() => login(f.email, f.password), () => { location.href = "/"; });
    else if (mode === "forgot") run(() => requestPasswordReset(f.email), () => setNotice("If there's an account for that email, the link is on its way. Check your inbox."));
    else run(() => updatePassword(f.password), () => { location.href = "/"; });
  }

  return (
    <main className="auth">
      <div className="auth-card">
        <Brand />
        <h1>{c.title}</h1>
        <p className="lead">{c.lead}</p>
        <form onSubmit={submit}>
          {needs.name && <label>Name<input name="name" autoComplete="name" value={f.name} onChange={set("name")} required /></label>}
          {needs.email && <label>Email<input name="email" type="email" autoComplete="email" value={f.email} onChange={set("email")} required /></label>}
          {needs.password && (
            <label>{mode === "reset" ? "New password" : "Password"}
              <input name="password" type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} value={f.password} onChange={set("password")} required minLength={mode === "login" ? undefined : 8} />
            </label>
          )}
          {error && <p className="form-error" role="alert">{error}</p>}
          {notice && <p className="lead" role="status">{notice}</p>}
          <button className={"button" + (ready ? " ready" : "")} type="submit" disabled={busy}>{c.button}</button>
        </form>
        {mode === "signup" && <p>Have an account? <Link href="/login">Log in</Link></p>}
        {mode === "login" && (
          <>
            <p><Link href="/forgot-password">Forgot your password?</Link></p>
            <p>
              No account yet? <Link href="/signup">Create one</Link>
              {demo ? <>, or{" "}<Link href="/" onClick={(e) => { e.preventDefault(); run(enterDemo, () => { location.href = "/"; }); }}>try the demo</Link></> : "."}
            </p>
          </>
        )}
        {mode === "forgot" && <p>Remembered it? <Link href="/login">Log in</Link></p>}
        <div className="auth-theme"><ThemeSwitch /></div>
      </div>
      <aside className="auth-aside" aria-hidden="true">
        <p className="auth-aside-title"><span className="live-dot" /> Meanwhile, in an inbox</p>
        <ol className="feed-list">
          {SAMPLE.map(([who, app, text]) => (
            <li key={who} className="feed-item">
              <div className="meta"><span className="avatar">{who[0]}</span><strong>{who}</strong><span className="tag">{app}</span></div>
              <p>{text}</p>
            </li>
          ))}
        </ol>
      </aside>
    </main>
  );
}
