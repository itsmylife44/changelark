// Server-only helpers. Never import this from a "use client" file: it reads the secret key.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { createHash } from "node:crypto";
import type { Database } from "./database.types";
import type { ApiError } from "../sdk/react-native/src/client";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;

export type Db = SupabaseClient<Database>;

// Bypasses RLS. Only for the SDK/public routes, which do their own checks.
let adminClient: Db | undefined;
export function admin(): Db {
  adminClient ??= createClient<Database>(URL, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  return adminClient;
}

// Acts as the signed-in developer (cookie session). Can set cookies in route handlers.
export async function userClient() {
  const store = await cookies();
  return createServerClient<Database>(URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => { try { list.forEach(({ name, value, options }) => store.set(name, value, options)); } catch {} },
    },
  });
}

// The signed-in developer, verified with getClaims (never trust getSession on the server).
export async function signedInUserId(): Promise<string | null> {
  const { data } = await (await userClient()).auth.getClaims();
  return data?.claims?.sub || null;
}

// The signed-in developer's id and email, or null.
export async function currentDev(): Promise<{ id: string; email: string } | null> {
  const { data } = await (await userClient()).auth.getClaims();
  const id = data?.claims?.sub;
  return id ? { id, email: String(data?.claims?.email || "").toLowerCase() } : null;
}

// A device is known only by a hash of its install id, so the raw id (which lets it delete its comments) is never stored.
export const tagOf = (installId: string) => createHash("sha256").update("changelark:" + installId).digest("hex").slice(0, 32);

// Anonymous display name, derived from the tag so nobody can pick someone else's name: a tree and four hex digits.
const TREE = ["Juniper", "Alder", "Rowan", "Cedar", "Birch", "Hazel", "Larch", "Willow", "Aspen", "Elm", "Linden", "Sequoia"];
export const nameOf = (tag: string) => `${TREE[parseInt(tag.slice(0, 2), 16) % TREE.length]}-${tag.slice(4, 8).toUpperCase()}`;

// The caller's IP from the proxy header (Vercel and most hosts set x-forwarded-for; see README for self-hosting).
export function clientIp(req: Request) {
  return (req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "unknown").split(",")[0].trim();
}

// Per-IP limits, stored as a hash of the IP. Generous on purpose: many people can share one IP (offices, mobile carriers).
export const LIMITS = {
  write: { limit: 120, seconds: 60 }, // votes, reports, blocks, comments
  comment: { limit: 30, seconds: 60 },
  demo: { limit: 20, seconds: 60 },
} as const;

export async function withinLimit(req: Request, kind: keyof typeof LIMITS) {
  const { limit, seconds } = LIMITS[kind];
  const bucket = `${kind}:${createHash("sha256").update("ip:" + clientIp(req)).digest("hex").slice(0, 32)}`;
  const { data, error } = await admin().rpc("rate_limit_hit", { p_bucket: bucket, p_limit: limit, p_window_seconds: seconds });
  if (error) { console.error(error); return true; } // fail open: a limiter outage shouldn't take the community down
  return data;
}

export const tooMany = (seconds: number) => Response.json(
  { error: { code: "slow_down", message: "Too many requests from your network. Try again in a minute." } },
  { status: 429, headers: { "Retry-After": String(seconds) } },
);

// Typed so every route answers with the shape the SDK expects.
export const json = <T,>(data: T, status = 200) => Response.json(data, { status });
export const fail = (status: number, code: string, message: string) => json<ApiError>({ error: { code, message } }, status);
