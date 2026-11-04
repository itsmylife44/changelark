import AuthPage from "../../components/auth";

export const metadata = { title: "Reset your password — Changelark", robots: { index: false } };

export default function Page() {
  return <AuthPage mode="forgot" />;
}
