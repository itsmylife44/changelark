import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { SITE_URL } from "../lib/site-url";

const sans = Inter({ subsets: ["latin"], variable: "--font-sans" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" });

export const metadata = {
  metadataBase: new URL(SITE_URL),
  title: "Changelark — release notes your users can answer",
  description: "Open-source release notes with a feedback loop: a public page per app, a sheet inside the app, and an inbox for the replies.",
};

export const viewport = { width: "device-width", initialScale: 1 };

// Applies a saved light/dark choice before paint, so the page never flashes the wrong theme.
const THEME = `try{var t=localStorage.getItem("changelark:theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: THEME }} /></head>
      <body>{children}</body>
    </html>
  );
}
