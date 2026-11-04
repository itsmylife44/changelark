import { Brand } from "./icons";
import { ThemeSwitch, LoginLink } from "./widgets";
import { REPO_URL } from "../lib/site-url";

// Header and footer for the marketing and docs pages.
export function SiteHeader({ current }: { current?: "docs" }) {
  return (
    <header className="site-header">
      <Brand href="/" />
      <nav className="site-links" aria-label="Main">
        <a href="/docs" aria-current={current === "docs" ? "page" : undefined}>Docs</a>
        <a href={REPO_URL}>GitHub ↗</a>
        <LoginLink />
        <a className="button small" href="/">Dashboard</a>
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
      <a href="/docs">Docs</a>
      <a href="/docs/swift">Swift</a>
      <a href="/docs/react-native">React Native</a>
      <a href="/">Dashboard</a>
      <ThemeSwitch />
    </footer>
  );
}

export function DocsTabs({ current }: { current: "overview" | "swift" | "react-native" }) {
  const tab = (id: string) => (current === id ? "page" : undefined);
  return (
    <nav className="docs-tabs" aria-label="Docs">
      <a href="/docs" aria-current={tab("overview")}>Overview</a>
      <a href="/docs/swift" aria-current={tab("swift")}>Swift</a>
      <a href="/docs/react-native" aria-current={tab("react-native")}>React Native</a>
      <span className="spacer" />
      <a href="/sdk/changelark-react-native-0.1.0.tgz" download>RN package ↓</a>
    </nav>
  );
}
