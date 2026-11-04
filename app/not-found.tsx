import { Brand } from "../components/icons";

export const metadata = { title: "Not found — Changelark", robots: { index: false } };

export default function NotFound() {
  return (
    <main className="page-narrow" style={{ marginTop: 64 }}>
      <Brand href="/" />
      <p className="label">404</p>
      <h1>Nothing here yet.</h1>
      <p className="lead">This page doesn&apos;t exist, or the app was removed. <a href="/" style={{ textDecoration: "underline" }}>Go to the start page</a></p>
    </main>
  );
}
