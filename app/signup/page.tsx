import AuthPage from "../../components/auth";

export const metadata = { title: "Create your account — Changelark", robots: { index: false } };

export default function Signup() {
  return <AuthPage mode="signup" />;
}
