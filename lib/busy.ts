// Shown when a store call throws (network failure) instead of returning its own error.
export const NETWORK_ERROR = "Something went wrong. Check your connection and try again.";

// Runs a store call that returns an error message (or null), with a busy flag around it.
// A throw becomes NETWORK_ERROR, so the form shows it like any other error.
export async function withBusy(setBusy: (busy: boolean) => void, action: () => Promise<string | null>): Promise<string | null> {
  setBusy(true);
  try { return await action(); }
  catch { return NETWORK_ERROR; }
  finally { setBusy(false); }
}
