// Where email links land: sign-up confirmation and password reset.
// Accepts both link styles: ?token_hash=&type= (our templates, works in any browser) and ?code= (PKCE, same browser only).
import type { EmailOtpType } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { safeNext } from "../../../lib/safe-next";
import { userClient } from "../../../lib/server";

const TYPES: EmailOtpType[] = ["email", "signup", "recovery", "email_change", "invite", "magiclink"];

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const next = safeNext(q.get("next"));
  const sb = await userClient();
  const tokenHash = q.get("token_hash");
  const type = q.get("type") as EmailOtpType | null;
  const code = q.get("code");
  let ok = false;
  if (tokenHash && type && TYPES.includes(type)) ok = !(await sb.auth.verifyOtp({ type, token_hash: tokenHash })).error;
  else if (code) ok = !(await sb.auth.exchangeCodeForSession(code)).error;
  redirect(ok ? next : "/login?error=link");
}
