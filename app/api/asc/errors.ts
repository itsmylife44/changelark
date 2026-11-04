import { fail } from "../../../lib/server";
import { AscError } from "../../../lib/asc";

// Apple-side problems are the developer's to fix (wrong key, missing role); anything else is ours.
export function ascFailure(e: unknown) {
  if (e instanceof AscError) return fail(400, "app_store_connect", e.message);
  console.error(e);
  return fail(500, "server_error", "Something went wrong talking to App Store Connect.");
}
