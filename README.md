<p align="center"><img src="docs/banner.png" alt="Changelark" width="640"></p>

# Changelark

Release notes your users can answer.

Write what changed once. Changelark puts it on a public page per app and in a half-height sheet inside your app, where users react and write back. Their feedback lands in one inbox, live.

**Status: experimental, not launched yet.** Every automated check passes against local test doubles, but Changelark has not yet run with a real App Store Connect key, App Attest on a physical iPhone, an app installed from Google Play, or a production SMTP provider.

- **Dashboard** for developers: apps, releases (published, draft or scheduled), moderation, live updates.
- **Public changelog** for every app, with a page per version, rendered on the server for search engines, with a sitemap.
- **Swift package** (SwiftUI, iOS 16+) and **React Native package** (iOS and Android, Expo or bare) that show What's new once per version.
- **Anonymous community**: votes, comments, replies, reports and blocks, and nobody has to sign up. When you answer someone, their next launch opens the chat so they see it.
- **Private bug reports** from inside the app, with a screenshot of the screen the person was on (stored in a private bucket).
- **Notes in several languages**: add translations per version; the app shows the one matching the phone, the public page offers a language switch. App Store Connect imports every localization.
- **Notifications**: new comments, reports and bug reports posted to Slack, Discord, Telegram or any webhook the moment they arrive, plus an **RSS feed** per app.
- **App Store Connect import**: link an app and its versions and What's New text arrive on their own. Versions in review become drafts and are published when they go live.
- **Abuse protection**: limits per install and per network, and optional **app proofs** (Apple App Attest, Google Play Integrity) so only genuine copies of your app can vote and comment.
- **Developer accounts** with email confirmation, password reset, profile settings, a daily email digest of new comments and reports, and self-service account deletion.

Built with Next.js 16, TypeScript and Supabase (Postgres, Auth, Row Level Security, Realtime).

## Why not just…

- **…the App Store "What's New" text?** It stays in the store, and users can't reply to it. Changelark shows the same notes inside your app, and turns them into votes, comments and bug reports you can answer. It can also import that text for you.
- **…a hosted changelog service?** Most give you a web page or a JavaScript widget on someone else's servers. Changelark ships a native SwiftUI and React Native sheet, it's MIT-licensed, and you run it on your own Supabase.
- **…a What's New library?** A library shows the screen and stops there. Changelark is the screen plus the backend: dashboard, public changelog, App Store Connect import, moderation.

**When to use something else:** if all you want is a static What's New screen, a library is lighter. If you don't want to run Supabase and a Node host, a hosted service is less work. There's no native Kotlin SDK: on Android, only React Native.

## Run it locally

You need Node 22+ and Docker, running (the Supabase CLI starts its services in containers).

```bash
git clone https://github.com/itsmylife44/changelark.git && cd changelark
npm install
npx supabase start          # local Postgres, Auth, Realtime and an email inbox
npx supabase status -o env  # prints the URL and keys for the next step
```

Create `.env.local` (`cp .env.example .env.local` gives you the first three lines, which are required; the rest are optional locally):

```bash
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...   # PUBLISHABLE_KEY from the status output
SUPABASE_SECRET_KEY=sb_secret_...                         # SECRET_KEY, server only, never NEXT_PUBLIC_
NEXT_PUBLIC_SITE_URL=http://localhost:3000                # optional locally; your domain in production (sitemap, canonical links)
CRON_SECRET=any-long-random-string                        # enables the scheduled App Store Connect import
NEXT_PUBLIC_SWIFT_PACKAGE_URL=https://github.com/you/changelark  # where Xcode fetches the Swift package
SMTP_URL=smtp://user:pass@smtp.example.com:587             # email digests of new comments and reports (any SMTP provider)
EMAIL_FROM="Changelark <alerts@your-domain>"
```

`WEBHOOK_ALLOW_LOCAL=1` lets webhooks reach local addresses. It exists only for the checks; in production webhooks must be public `https://` addresses.

Then:

```bash
npm run dev
```

Open http://127.0.0.1:3000. Without an account you land in a shared demo workspace with sample apps and a pretend phone to try the in-app sheet. The demo is on only in `npm run dev`; a production build sends signed-out visitors to the login unless you set `DEMO_MODE=true`. Sign-up emails (confirmation, password reset) arrive in the local inbox at http://127.0.0.1:54324.

Use port 3000: it's the `site_url` in `supabase/config.toml`, so the links in emails point there.

## Checks

Start the app against the pretend App Store Connect the checks bring along:

```bash
npm run build && DEMO_MODE=true ASC_API_URL=http://127.0.0.1:4010 CRON_SECRET=local-cron \
  APP_ATTEST_ROOT_PEM=scripts/.attest-test-root.pem PLAY_INTEGRITY_URL=http://127.0.0.1:4011 \
  SMTP_URL=smtp://127.0.0.1:54325 npm start
```

Then, in another terminal:

```bash
npm run check:backend -- http://127.0.0.1:3000   # API, RLS isolation, rate limits, email confirmation
npm run check:ui -- http://127.0.0.1:3000        # 68-step click-through in a real browser (Playwright)
npm run check:proofs -- http://127.0.0.1:3000    # App Attest and Play Integrity with test certificates (needs SUPABASE_SECRET_KEY)
npx tsc --noEmit
npx supabase db advisors                          # Supabase security and performance advisors
```

## Deploy

1. **Supabase.** Create a project, then link it and push the schema:
   ```bash
   npx supabase link --project-ref <your-ref>
   npx supabase db push
   ```
2. **Auth settings** (Supabase dashboard → Authentication):
   - **URL configuration:** set Site URL to your domain and add `https://your-domain/**` to the redirect URLs.
   - **Email templates:** paste `public/email-templates/confirmation.html` into "Confirm signup" and `recovery.html` into "Reset password". Their links go to `/auth/confirm`, which works from any browser.
   - **SMTP:** add your own provider (Resend, Postmark, SendGrid…). Supabase's built-in sender only delivers to your team's addresses.
3. **Vercel** (or any Node host). Import the repo, set the environment variables above with your project's values (`NEXT_PUBLIC_SITE_URL` = your domain, a random `CRON_SECRET`) and deploy. `vercel.json` runs the App Store Connect import and the email digest daily; Vercel's paid plans allow hourly (`0 * * * *`). On other hosts, call `GET /api/cron/asc-sync` with `Authorization: Bearer $CRON_SECRET` from any scheduler.

To run the site on your own server with Docker and HTTPS, or with a self-hosted Supabase, see [Self-hosting](docs/self-hosting.md).

## App Store Connect

In App Store Connect, open **Users and Access → Integrations → App Store Connect API**, create a team key with the **App Manager** role and download the `.p8` file (Apple lets you download it once). In Changelark, open **Account → App Store Connect** and enter the Issuer ID, the Key ID and the file.

- The key is checked with Apple before it's saved, then stored encrypted in **Supabase Vault**. Only the server can read it. Disconnecting or deleting the account deletes it.
- An app can only be linked to an App Store app that key can see, which also proves the app is yours.
- Imported: iOS versions that are live or were live (published), and versions on their way (drafts, published automatically once live). Rejected versions are skipped. Notes come from `whatsNew`, preferring English.
- Releases you wrote by hand are never changed.

## App proofs

Turn on **App proofs** in an app's **Settings** tab to accept votes, comments and reports only from genuine copies of the app:

- **iOS (App Attest):** enter the App ID (`TEAMID.bundle.id`) and the environment. The first write from a device attests its key; every write after that carries an assertion. The server checks the certificate chain up to Apple's App Attest root, the challenge, the App ID and a counter that only goes up.
- **Android (Play Integrity):** enter the package name and connect a Google service account in **Account** (stored in Supabase Vault). The server has Google decode each token and requires a Play-recognized app on a device that meets device integrity, with the right nonce, from the last five minutes.
- Your app provides `getAppProof` through its own native module; see `/docs/react-native`.
- While proofs are required, the public web page and the pretend phone are read-only for that app.

Always on, for every app: 5 comments a minute per install, 30 comments and 120 writes a minute per network. The network comes from `x-forwarded-for`; Vercel sets it, and if you self-host make sure your proxy does, or every request looks like the same network.

`APP_ATTEST_ROOT_PEM` and `PLAY_INTEGRITY_URL` exist only for the checks. Never set them in production.

## How it fits together

| Who | Talks to | Auth |
| --- | --- | --- |
| Developer (dashboard) | Supabase Data API from the browser | Supabase Auth session + RLS: each developer only sees their own apps |
| Visitors and in-app package | `/api/v1/sdk/*` route handlers | Public app key (`clk_…`) + a random install ID |
| Public changelog pages | `/api/v1/public/[slug]`, then the SDK API | none |

- The **app key is public** by design: it can read published notes and post anonymous feedback, nothing else. Developers can replace it in the dashboard.
- Install IDs are stored only as a **hash**. Display names like `Juniper-4C2F` are derived from it.
- Anonymous tables (`votes`, `installs`) have **no RLS policies**, so only the server (secret key) can reach them.
- Vote counters are kept by a database trigger. Developers can't edit them.
- Bug reports and their screenshots are readable only by the app's owner (RLS on `bug_reports`, a storage policy on the private `screenshots` bucket, short-lived signed URLs).
- The webhook address is never sent to visitors or apps. Messages go out after the response, so a slow webhook never slows anyone down.

Schema and policies: `supabase/migrations/`. API contract: `sdk/react-native/src/client.d.ts`, shared by the server route and the package.

## Swift package

`Package.swift` at the repository root points at `sdk/swift`, so Xcode can add the package by this repository's URL. Set `NEXT_PUBLIC_SWIFT_PACKAGE_URL` to that URL so the dashboard and docs show it. Tests: `swift test` (add `CHANGELARK_TEST_URL=http://127.0.0.1:3000` to also run against a local server). Usage is at `/docs/swift`.

## React Native package

The package lives in `sdk/react-native`. `npm run build` packs it into `public/sdk/` so the dashboard and docs can offer it as a download. Usage is in [the React Native guide](app/docs/react-native/page.tsx) (served at `/docs/react-native`).

## Ideas for later

Contributions welcome:

- Live updates in the apps (today they load on open)
- Several developers per app
- Replies to bug reports
- Visit statistics for changelog pages

## Contributing

Bugs and ideas go in [Issues](https://github.com/itsmylife44/changelark/issues); see [CONTRIBUTING.md](CONTRIBUTING.md). Security problems go through [SECURITY.md](SECURITY.md), never a public issue.

## License

[MIT](LICENSE)
