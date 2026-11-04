import Link from "next/link";
import { Brand } from "./icons";
import { ThemeSwitch, LoginLink } from "./widgets";
import { REPO_URL } from "../lib/site-url";

// Header and footer for the marketing and docs pages.
export function SiteHeader({ current }: { current?: "docs" }) {
  return (
    <header className="site-header">
      <Brand href="/" />
      <nav className="site-links" aria-label="Main">
        <Link href="/docs" aria-current={current === "docs" ? "page" : undefined}>Docs</Link>
        <a href={REPO_URL}>GitHub ↗</a>
        <LoginLink />
        <Link className="button small" href="/">Dashboard</Link>
      </nav>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <Brand href={REPO_URL} />
      <span>Open source, MIT.</span>
      <span className="spacer" />
      <Link href="/docs">Docs</Link>
      <Link href="/docs/swift">Swift</Link>
      <Link href="/docs/react-native">React Native</Link>
      <Link href="/">Dashboard</Link>
      <ThemeSwitch />
    </footer>
  );
}

export function DocsTabs({ current }: { current: "overview" | "swift" | "react-native" }) {
  const tab = (id: string) => (current === id ? "page" : undefined);
  return (
    <nav className="docs-tabs" aria-label="Docs">
      <Link href="/docs" aria-current={tab("overview")}>Overview</Link>
      <Link href="/docs/swift" aria-current={tab("swift")}>Swift</Link>
      <Link href="/docs/react-native" aria-current={tab("react-native")}>React Native</Link>
      <span className="spacer" />
      <a href="/sdk/changelark-react-native-0.1.0.tgz" download>RN package ↓</a>
    </nav>
  );
}
