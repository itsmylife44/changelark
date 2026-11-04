// The shared demo workspace. POST makes sure the demo account exists (and undoes password/email changes);
// POST {reset:true} from the signed-in demo user puts the sample data back.
import { admin, signedInUserId, json, fail, withinLimit, tooMany, LIMITS, type Db } from "../../../lib/server";
import type { TablesInsert } from "../../../lib/database.types";
import { createClient } from "@supabase/supabase-js";
import { DEMO, demoEnabled } from "../../../lib/demo-account";

// Sample data for the demo workspace. Made up for Changelark: a tide app, a budget app, a recipe app and a sleep app.
const TIDEPOOL_NOTES: Record<string, string> = {
  "2.4": `Tide charts got a full rework.

- Swipe between days on the tide chart
- Swell height and period on the same graph
- Moon phase under every day
- Home screen widget for your favourite beach`,
  "2.3": `Spot alerts are here.

- Get a notification when the swell at a saved spot fits your level
- Quiet hours for alerts
- Fixed wrong sunrise times south of the equator`,
  "2.2": `Offline maps for 40 coastlines, and a darker night mode for early sessions.`,
};

const APPS: Omit<TablesInsert<"apps">, "owner_id">[] = [
  {
    slug: "tidepool", name: "Tidepool: Tides & Surf", color: "#0E9F9A", key: "clk_t1d3p00l7q",
    description: "Tides, swell and wind for the beach you actually go to.\n\nTidepool reads the forecast for your saved spots and turns it into one simple chart per day.\nNo account, no ads. Works offline once a coastline is downloaded.",
    store_url: "https://apps.apple.com/", contact: "mailto:hello@example.com", synced_at: "2026-10-29T15:00:00Z",
  },
  { slug: "ledgerly", name: "Ledgerly", color: "#D9480F", description: "A budget you can read in ten seconds.", key: "clk_l3dg3rly0x", synced_at: "2026-10-20T09:00:00Z" },
  { slug: "fernwood", name: "Fernwood Recipes", color: "#2F9E44", description: "Seasonal recipes from a small kitchen.", key: "clk_f3rnw00d0x", synced_at: "2026-10-18T09:00:00Z" },
  { slug: "nightjar", name: "Nightjar", color: "#5F3DC4", description: "Field recordings to fall asleep to.", key: "clk_n1ghtj4r0x", synced_at: "2026-10-12T09:00:00Z" },
];

async function demoUserId(db: Db): Promise<string | null> {
  const { data: app } = await db.from("apps").select("owner_id").eq("slug", APPS[0].slug).maybeSingle();
  if (app) return app.owner_id;
  const made = await db.auth.admin.createUser({ email: DEMO.email, password: DEMO.password, email_confirm: true, user_metadata: { name: DEMO.name } });
  if (made.data?.user) return made.data.user.id;
  // ponytail: scans the first 1000 users; only reached if the demo user exists without its sample app.
  const { data } = await db.auth.admin.listUsers({ perPage: 1000 });
  return data?.users.find((u) => u.email === DEMO.email)?.id || null;
}

async function demoLoginWorks() {
  const probe = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await probe.auth.signInWithPassword({ email: DEMO.email, password: DEMO.password });
  if (!error) await probe.auth.signOut({ scope: "local" }).catch(() => {});
  return !error && data.user?.user_metadata?.name === DEMO.name;
}

async function seed(db: Db, owner: string) {
  await db.from("apps").delete().eq("owner_id", owner);
  const { data: apps, error } = await db.from("apps").insert(APPS.map((a) => ({ store_url: "", contact: "", ...a, owner_id: owner }))).select("id, slug");
  if (error) throw error;
  const tidepool = apps.find((a) => a.slug === APPS[0].slug)!;
  const dates: Record<string, string> = { "2.4": "2026-10-26", "2.3": "2026-09-30", "2.2": "2026-08-14" };
  const ups: Record<string, number> = { "2.4": 7, "2.3": 12, "2.2": 5 };
  const { error: e2 } = await db.from("releases").insert(Object.entries(TIDEPOOL_NOTES).map(([version, notes]) => ({ app_id: tidepool.id, version, release_date: dates[version], notes, published: true, up_count: ups[version] })));
  if (e2) throw e2;
  await seedFeedback(db, tidepool.id);
}

// A little conversation and one bug, so the inbox isn't empty on the first visit.
async function seedFeedback(db: Db, appId: string) {
  const { data: rel } = await db.from("releases").select("id").eq("app_id", appId).eq("version", "2.4").single();
  if (!rel) return;
  const say = (body: string, author_name: string, author_tag: string | null, parent_id: string | null = null) =>
    db.from("comments").insert({ release_id: rel.id, body, author_name, author_tag, is_dev: !author_tag, parent_id }).select("id").single();
  const { data: first } = await say("The swell graph is exactly what I check before paddling out.", "Juniper-4C2F", "demo-seed-juniper");
  if (first) await say("Thanks! Wind arrows on the same graph are next.", DEMO.name, null, first.id);
  await say("Could the widget show tomorrow's low tide too?", "Alder-7A1B", "demo-seed-alder");
  await db.from("bug_reports").insert({ app_id: appId, version: "2.4", body: "The tide chart jumps back to today when I rotate the phone.", device: "iPhone 15, iOS 26.1", reporter_tag: "demo-seed-rowan", reporter_name: "Rowan-09E3" });
}

export async function POST(req: Request) {
  if (!demoEnabled()) return fail(404, "demo_off", "The demo workspace is turned off on this server.");
  if (!(await withinLimit(req, "demo"))) return tooMany(LIMITS.demo.seconds);
  const db = admin();
  const { reset } = await req.json().catch(() => ({}));
  try {
    const id = await demoUserId(db);
    if (!id) return fail(500, "demo_unavailable", "The demo account couldn't be created.");
    if (reset && (await signedInUserId()) !== id) return fail(403, "not_demo", "Only the demo workspace can be reset.");
    // Changing the password signs out every open demo session, so only repair it when the demo login really broke.
    if (!(await demoLoginWorks())) await db.auth.admin.updateUserById(id, { email: DEMO.email, password: DEMO.password, user_metadata: { name: DEMO.name } });
    const { count } = await db.from("apps").select("id", { count: "exact", head: true }).eq("owner_id", id);
    if (reset || !count) await seed(db, id);
    return json({ ok: true });
  } catch (e) {
    console.error(e);
    return fail(500, "demo_failed", "The demo workspace couldn't be prepared.");
  }
}
