// Public on purpose: anyone can open the shared demo workspace. /api/demo restores these if someone changes them.
export const DEMO = { email: "demo@changelark.example", password: "demo1234", name: "Noor Haddad" } as const;

// Server only. The demo is on for `npm run dev`, off in production builds unless DEMO_MODE=true,
// so a real install never hands strangers a dashboard that writes into its database.
export function demoEnabled(): boolean {
  if (process.env.DEMO_MODE) return process.env.DEMO_MODE === "true";
  return process.env.NODE_ENV !== "production";
}
