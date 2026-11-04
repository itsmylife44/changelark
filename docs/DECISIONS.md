# Design decisions

Why Changelark works the way it does. Newest first. Add an entry when a decision would surprise someone reading the code.

## 2026-11-04 · Self-hosting with Docker, your choice of pieces

Supabase Cloud's free tier runs out, so the database and the site can each be hosted wherever you like: Supabase Cloud or self-hosted Supabase, and Docker on any server or any Next.js host. The code doesn't change between the four combinations ([research](research/supabase-self-hosting.md)).

- **Two compose files.** `docker-compose.yml` runs the app, a cron container and Caddy (automatic HTTPS, can be switched off). `docker-compose.supabase.yml` pulls in Supabase's official compose with `include:`, pinned to a release, so Supabase keeps maintaining it. `COMPOSE_FILE` in `.env` picks the set.
- **Built locally.** `NEXT_PUBLIC_*` values are inlined at build time, so the image is built from your `.env`, not pulled prebuilt.
- **Nothing to remember.** A cron container replaces `vercel.json` crons and runs a nightly backup (Postgres dump, the `db-config` volume that holds the Vault key, storage, `.env`; last 7 kept). A one-shot `migrate` container applies migrations on every `up`. Studio listens on `127.0.0.1` only.
- **One setup script.** `scripts/setup.sh` generates every secret, writes `.env`, and creates the first account through the admin API. Sign-up stays closed by default: most instances have one to three people.
- **Email is optional.** Without SMTP, accounts are confirmed automatically, passwords are reset from Studio, and email alerts are hidden. Auth email templates are served from `public/email-templates/`, because self-hosted Auth ignores `supabase/templates/`.
- **Telegram** is one more webhook format, next to Slack and Discord: paste a `sendMessage?chat_id=` URL. Anything else goes through the generic JSON webhook.
- **Not in v1:** moving Vault secrets from Cloud to self-hosted. Export the database and paste the two store keys again.

## 2026-11-04 · Close the loop, not just announce

Release notes are usually one-way. Changelark's point is the way back: what users say about an update, in the same place you wrote it.

- **Bug reports with a screenshot** come from the sheet, because that's where people are when something feels off after an update. They are private (only the app's owner can read them, screenshots sit in a private bucket and open through ten-minute signed URLs), so nobody is tempted to file bugs as public comments.
- **Webhooks** post new comments, reports and bugs to Slack, Discord or any endpoint. They run after the response (`after()`), so a slow webhook never slows the person writing. Only public `https://` hosts are allowed in production.
- **Translations** are stored per version as a JSON object next to the original notes, not as separate rows: a version is still one thing to publish, unpublish or delete. The phone's language picks the text; the original is the fallback. App Store Connect localizations are imported as translations.
- **RSS** per app, for people who follow updates in a feed reader and for tools that poll.

## 2026-11-04 · Own name and identity

The project is called **Changelark**: the words that come after an update, both the developer's and the users'. The logo is a speech bubble holding two lines, the note and the reply. Public keys start with `clk_`, anonymous people are named after trees (`Juniper-4C2F`), and public pages live under `/apps/<app>/<version>`.

## 2026-11-04 · Layout: an inbox, not a list of releases

- **Dashboard:** a top bar with the app switcher; versions as a timeline on the left, the editor in the middle, the live feedback feed on the right. Feedback is the reason to open the dashboard, so it's always on screen.
- **Public page:** two columns, with the version index fixed on the left so any version is one click away on long histories.
- **In the app:** a half-height sheet (it doesn't hide the app the person just updated), notes as a short list, two big reactions, and feedback as a chat with bubbles, because a reply from the developer reads like a conversation.
- **Docs:** tabs and a single column; **login:** the form next to a preview of what's waiting in the inbox.

## 2026-11-03 · Open source and self-hosted

MIT licence, no paid plans. Anyone can run it on Supabase (Postgres, Auth, Realtime, Storage) and Next.js. The demo workspace and a pretend phone make it possible to try everything without an account or a device.

## 2026-11-03 · Anonymous by default, protected by the server

- Users never sign up. Each install has a random ID kept on the device; the server stores only its hash.
- The app key is public on purpose, like a web address. It can read published notes and post anonymous feedback, nothing else.
- Abuse is handled on the server: per-install and per-network rate limits, reports, blocks, developer moderation, and optional app proofs (Apple App Attest, Google Play Integrity) so only genuine copies of an app can write.
- Row Level Security on every table; anonymous tables have no policies at all, so only the server can reach them.

## 2026-11-03 · Both mobile platforms

A Swift package (SwiftUI) and a React Native package (iOS and Android) share one HTTP contract (`sdk/react-native/src/client.d.ts`), which the server route is typed against too.
