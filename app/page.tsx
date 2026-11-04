import { connection } from "next/server";
import { hasMail } from "../lib/mail";
import { demoEnabled } from "../lib/demo-account";
import Dashboard from "../components/dashboard";

export const metadata = { title: "Changelark — feedback inbox", robots: { index: false } };

// The start page is the software itself: it opens the workspace, or without an account the demo (when on) or the login.
export default async function Page() {
  await connection();
  return <Dashboard smtpConfigured={hasMail()} demo={demoEnabled()} />;
}
