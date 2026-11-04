import { connection } from "next/server";
import AuthPage from "../../components/auth";
import { demoEnabled } from "../../lib/demo-account";

export const metadata = { title: "Log in — Changelark", robots: { index: false } };

// Rendered per request: DEMO_MODE is read at run time, not baked in at build time.
export default async function Login() {
  await connection();
  return <AuthPage mode="login" demo={demoEnabled()} />;
}
