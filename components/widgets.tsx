"use client";
import { useEffect, useState } from "react";
import { Icon } from "./icons";
import { supabase } from "../lib/supabase";

// "Log in" for the static marketing and docs headers, shown only once we know nobody is signed in.
export function LoginLink() {
  const [signedOut, setSignedOut] = useState(false);
  useEffect(() => { supabase().auth.getSession().then(({ data }) => setSignedOut(!data.session)); }, []);
  return signedOut ? <a className="keep" href="/login">Log in</a> : null;
}

export function CopyCode({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="docs-code">
      {/* Focusable so keyboard users can scroll long lines. */}
      <pre tabIndex={0} aria-label="Code"><code>{code}</code></pre>
      <button
        type="button"
        onClick={() => navigator.clipboard?.writeText(code).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); })}
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

type Theme = "light" | "dark" | "system";

// Light, dark or follow the system. "System" removes the override so the CSS media query decides.
export function ThemeSwitch() {
  const [mode, setMode] = useState<Theme>("system");
  useEffect(() => {
    const saved = localStorage.getItem("changelark:theme");
    if (saved === "light" || saved === "dark") setMode(saved);
  }, []);
  const pick = (m: Theme) => {
    setMode(m);
    const root = document.documentElement;
    root.classList.add("theme-switching"); // no color transitions during the swap
    if (m === "system") { delete root.dataset.theme; localStorage.removeItem("changelark:theme"); }
    else { root.dataset.theme = m; localStorage.setItem("changelark:theme", m); }
    void root.offsetHeight;
    requestAnimationFrame(() => root.classList.remove("theme-switching"));
  };
  return (
    <div className="theme-switch" role="group" aria-label="Theme">
      <button type="button" aria-label="Light" aria-pressed={mode === "light"} onClick={() => pick("light")}><Icon name="sun" size={14} /></button>
      <button type="button" aria-label="Dark" aria-pressed={mode === "dark"} onClick={() => pick("dark")}><Icon name="moon" size={14} /></button>
      <button type="button" aria-label="System" aria-pressed={mode === "system"} onClick={() => pick("system")}><Icon name="monitor" size={14} /></button>
    </div>
  );
}
