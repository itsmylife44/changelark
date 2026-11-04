// App details for its public changelog page. The page then loads notes and comments through /api/v1/sdk with the app's public key.
import { admin, signedInUserId, json, fail } from "../../../../../lib/server";

export interface PublicApp { slug: string; name: string; color: string; description: string; storeUrl: string; contact: string; key: string; isOwner: boolean; readOnly: boolean }

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { data: app } = await admin().from("apps")
    .select("slug, name, color, description, store_url, contact, key, owner_id, proof_mode").eq("slug", slug).maybeSingle();
  if (!app) return fail(404, "app_not_found", "No changelog here.");
  const { owner_id, store_url, proof_mode, ...rest } = app;
  return json<PublicApp>({ ...rest, storeUrl: store_url, readOnly: proof_mode === "required", isOwner: owner_id === (await signedInUserId()) });
}
