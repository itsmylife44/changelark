import AuthPage from "../../components/auth";

export const metadata = { title: "Choose a new password — Changelark", robots: { index: false } };

export default function Page() {
  return <AuthPage mode="reset" />;
}
