# Self-hosting

The database and the site can each live wherever you like. The code is the same in all four combinations; only the values in your environment change.

| | Site in Docker (`docker compose up`) | Site on any Next.js host (Vercel, Netlify, a Node server…) |
| --- | --- | --- |
| **Supabase Cloud** | This guide. Point `.env` at your Cloud project. | The [Deploy](../README.md#deploy) steps in the README. |
| **Self-hosted Supabase** | [Supabase in the same Docker](#supabase-in-the-same-docker) below, or this guide with your own Supabase's URL and keys in `.env`. | The README's Deploy steps, with your own Supabase's URL and keys, for example [only Supabase in Docker](#only-supabase-in-docker-site-on-vercel). |

For self-hosted Supabase, `NEXT_PUBLIC_SUPABASE_URL` is its public gateway URL (`SUPABASE_PUBLIC_URL`) and the keys are its `SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_SECRET_KEY` ([research](research/supabase-self-hosting.md)).

## Site in Docker

You need a server with Docker, a domain pointing at it, and ports 80 and 443 open.

1. Set up the database: either the Supabase and Auth steps of the README's [Deploy](../README.md#deploy) section, or your self-hosted Supabase.
2. Create `.env` next to `docker-compose.yml`:

   ```bash
   DOMAIN=changelark.example.com
   COMPOSE_PROFILES=caddy          # leave out if you already run a proxy
   NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
   SUPABASE_SECRET_KEY=sb_secret_...
   # NEXT_PUBLIC_SITE_URL defaults to https://$DOMAIN
   # optional, as in the README: CRON_SECRET, NEXT_PUBLIC_SWIFT_PACKAGE_URL, SMTP_URL, EMAIL_FROM
   ```

3. Build and start:

   ```bash
   docker compose up -d --build
   ```

Changelark is now at `https://$DOMAIN`. Caddy gets and renews the certificate on its own.

**`NEXT_PUBLIC_*` values are written into the site when the image is built.** After changing one, run `docker compose up -d --build` again. Other values only need `docker compose up -d`.

### Your own proxy instead of Caddy

Leave `COMPOSE_PROFILES=caddy` out of `.env`. The app listens on `127.0.0.1:3000`; point your proxy there. To listen elsewhere, set `APP_PORT` (for example `APP_PORT=0.0.0.0:8080`).

Your proxy must set `X-Forwarded-For` (Caddy does): the rate limits group writes by network, and without it every request looks like the same network.

### Scheduled jobs

The `cron` container replaces the `vercel.json` crons: the App Store Connect import at 06:15 and the email alerts at 07:00 (UTC). It calls the app with `CRON_SECRET`, so set that in `.env` (`scripts/setup.sh` generates one). Without `SMTP_URL` it skips the alerts. With [Supabase in the same Docker](#supabase-in-the-same-docker) it also makes the nightly [backup](#backups). Each run, and any failure, shows up in `docker compose logs cron`.

To run a job now: `docker compose exec cron /cron/run.sh asc-sync`.

`node scripts/check-selfhost.mjs` checks the setup against your `.env`.

## Supabase in the same Docker

To keep the database on your server too, run Supabase's official stack next to the site. `docker-compose.supabase.yml` pulls in Supabase's own compose file from a fixed release (the tag in that file), with a few changes in `supabase/compose.override.yml`. The Supabase API shares your domain: Caddy sends `/auth/v1`, `/rest/v1`, `/realtime/v1` and `/storage/v1` to it and everything else to the site.

You need a server with Docker (4 GB of RAM or more), `curl`, `openssl`, and `node` or Docker, plus a domain pointing at it and ports 80 and 443 open.

1. Write `.env`, start everything and create your account:

   ```bash
   sh scripts/setup.sh
   ```

   It asks for the domain (or takes `DOMAIN=...` from the environment), generates every secret with Supabase's `generate-keys.sh`, creates the `sb_publishable_`/`sb_secret_` keys with Supabase's `add-new-auth-keys.sh`, and writes `.env`. That includes `COMPOSE_FILE=docker-compose.yml:docker-compose.supabase.yml`, which switches the Supabase stack on. Running it again only adds settings that are missing; it never changes a value already in `.env`. If `.env` still points at another Supabase (Cloud, say), it stops and tells you which lines to remove.

   Then it asks for the email and password of your account (or takes `ADMIN_EMAIL=...` and `ADMIN_PASSWORD=...` from the environment), runs `docker compose up -d --build` if the stack isn't up yet, and creates the account, already confirmed, with Auth's admin API. Sign in at `https://$DOMAIN/login`. The password is not stored in `.env`. Once Changelark has an account, running the script again leaves accounts alone. Without a terminal and without `ADMIN_EMAIL` it skips this part and tells you so.

   On every `up`, a one-shot `migrate` container applies `supabase/migrations` before the site starts. Migrations already applied are skipped. After changing `.env` later, run `docker compose up -d --build` yourself.

2. Check it, on the server:

   ```bash
   ADMIN_EMAIL=you@example.com ADMIN_PASSWORD=... node scripts/check-selfhost.mjs
   ```

   Without `ADMIN_EMAIL`/`ADMIN_PASSWORD` it skips the sign-in check.

### Sign-up

Sign-up is closed: `.env` has `DISABLE_SIGNUP=true`, so the sign-up page answers that sign-ups are not allowed and nobody else can make an account. To open it, for a team say, change that line to `DISABLE_SIGNUP=false` and run `docker compose up -d`. Set it back to `true` the same way. Accounts that already exist keep working either way.

An `.env` written by an older `setup.sh` has `DISABLE_SIGNUP=false` (Supabase's default) and the script won't change it: set it to `true` yourself.

To go back to Supabase Cloud, remove the `COMPOSE_FILE` line and put your Cloud project's `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_SECRET_KEY` in `.env`, then `docker compose up -d --build`. Nothing else changes.

### Email

Email is optional. `setup.sh` asks for an SMTP server; press Enter to skip it. Without a terminal, pass `SMTP_HOST`, `SMTP_PORT` (587 if left out), `SMTP_USER`, `SMTP_PASS` and `SMTP_ADMIN_EMAIL` (the sender address) in the environment.

- **Without SMTP**, new accounts are confirmed without an email (`ENABLE_EMAIL_AUTOCONFIRM=true`), the dashboard doesn't offer email alerts and the cron skips them. To reset a password, see below.
- **With SMTP**, Auth sends Changelark's confirmation and password reset emails, and their links open the app's `/auth/confirm` page. Self-hosted Auth ignores `supabase/config.toml`, so the templates live in `public/email-templates/`: the app serves them, and `supabase/compose.override.yml` points Auth at them (`GOTRUE_MAILER_TEMPLATES_*`). The same files are the templates for `supabase start` and for Cloud. The script writes the `SMTP_*` settings Auth reads, `SMTP_URL` and `EMAIL_FROM` for the app's alerts, and `ENABLE_EMAIL_AUTOCONFIRM=false`.

To add SMTP later, run `setup.sh` again: it asks again while `.env` has no `SMTP_URL`, and `SMTP_HOST=...` in the environment replaces the current one. It only rewrites the email settings, nothing else in `.env`. Then run `docker compose up -d`.

Any SMTP provider works. Some with a free tier: [Resend](https://resend.com/docs/send-with-smtp) (`smtp.resend.com`, user `resend`, an API key as password), [Postmark](https://postmarkapp.com/developer/user-guide/send-email-with-smtp) (`smtp.postmarkapp.com`, a server token as both user and password) and [Brevo](https://www.brevo.com) (`smtp-relay.brevo.com`). Use port 587, or 465 for TLS from the start. The sender address must be on a domain you have verified with the provider.

#### Reset a password from Studio

Without SMTP nobody gets a reset email. Open Studio (below), go to the SQL editor and run, with the account's email and a new password:

```sql
update auth.users
set encrypted_password = extensions.crypt('new-password', extensions.gen_salt('bf'))
where email = 'you@example.com';
```

Then sign in with the new password and change it again from the account page if you like.

### Studio

Studio, the Supabase gateway and Postgres listen on `127.0.0.1` only, so they are not on the internet. Open Studio through an SSH tunnel from your computer:

```bash
ssh -N -L 8000:127.0.0.1:8000 you@your-server
```

Then go to <http://localhost:8000> and sign in with `DASHBOARD_USERNAME` and `DASHBOARD_PASSWORD` from `.env`. Postgres works the same way on port 5432 (user `postgres.<POOLER_TENANT_ID>`, password `POSTGRES_PASSWORD`).

### Your own proxy

Without Caddy, send `/auth/v1/*`, `/rest/v1/*`, `/realtime/v1/*` (WebSockets) and `/storage/v1/*` to `127.0.0.1:8000`, and everything else to `127.0.0.1:3000`. The site's server calls the Supabase API at `https://$DOMAIN` too, so the server must be able to reach its own domain.

### Only Supabase in Docker, site on Vercel

The same stack can serve a site hosted elsewhere. Give Supabase its own domain pointing at the server, say `api.example.com`; that is the public URL the site gets.

1. Write `.env` without starting anything: `DOMAIN=api.example.com sh scripts/setup.sh < /dev/null`.
2. In `.env`, set `SITE_URL=https://<your site>` and `ADDITIONAL_REDIRECT_URLS=https://<your site>/**`, so Auth's email links open the site. Keep the `COMPOSE_FILE` line: the Supabase file adds to the app's services, it can't run without `docker-compose.yml`.
3. Start every service except the app and the cron, then Caddy on its own (it routes the four API paths to the gateway; other paths on that domain answer 502, and Studio stays private):

   ```bash
   docker compose up -d $(docker compose config --services | grep -vxE 'app|cron|caddy')
   docker compose up -d --no-deps caddy
   ```

4. Create your account: `ADMIN_EMAIL=you@example.com ADMIN_PASSWORD=... sh scripts/setup.sh`.
5. On Vercel, follow the README's Deploy steps with `NEXT_PUBLIC_SUPABASE_URL=https://api.example.com`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` = `SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_SECRET_KEY` from `.env`. Vercel runs the scheduled jobs (`vercel.json`).
6. Backups: the `cron` container isn't running, so call it from the server's crontab, e.g. `30 3 * * * cd ~/changelark && docker compose run --rm --no-deps cron /cron/backup.sh`.

Migrations run with `migrate` in step 3; after a `git pull`, run step 3 again.

### Upgrading

```bash
git pull && docker compose up -d --build
```

This updates the site and, when the pinned Supabase release changed, Supabase too. New migrations run on the way up. Run a [backup](#backups) first and copy it off the server. Supabase's own upgrade script (`update.sh`) is no substitute: it saves its configuration files, not the database or Storage.

### Backups

Every night at 03:30 (UTC) the `cron` container writes `backups/changelark-<date>.tar.gz` next to `docker-compose.yml` and keeps the newest 7. Each archive holds:

- `db.dump`: the whole database (`pg_dump -Fc`);
- `db-config/`: the volume with `pgsodium_root.key`, the key the Vault needs. Without it, the App Store Connect and Play keys in the database can't be read any more;
- `storage/`: the bug report screenshots;
- `.env`: every secret of the stack.

To make one now: `docker compose exec cron /cron/backup.sh`. Runs and failures show up in `docker compose logs cron`; `node scripts/check-selfhost.mjs` makes one and checks all four parts are in it.

**Copy the backups off the server.** A backup that lives on the same disk goes when the server goes. For example, from your computer: `rsync -a you@your-server:changelark/backups/ ./changelark-backups/`. The archives hold `.env` and the Vault key, so keep the copy somewhere private.

### From Supabase Cloud to self-hosted

1. Set up the stack without creating an account, since your Cloud accounts come over with the data: `DOMAIN=changelark.example.com sh scripts/setup.sh < /dev/null`, then `docker compose up -d --build`. The migrations create the tables.
2. Export the data from the Cloud project and load it, following Supabase's [Restore a Platform Project to Self-Hosted](https://supabase.com/docs/guides/self-hosting/restore-from-platform). The schema already exists, so the data dump is the part you need:

   ```bash
   npx supabase db dump --db-url "<Cloud connection string>" --data-only --use-copy -f data.sql
   psql "postgresql://postgres.<POOLER_TENANT_ID>:<POSTGRES_PASSWORD>@127.0.0.1:5432/postgres" \
     -c 'SET session_replication_role = replica' -f data.sql
   ```

3. Enter the store keys again: the App Store Connect key in your account settings, and each app's App proofs keys. The Vault encrypts them with a key that stays with the Cloud project, so the copies in the dump can't be read here.

Screenshots of bug reports stay in the Cloud project's Storage: the guide doesn't move Storage files.

### Old and new API keys

Supabase's scripts make both the legacy `ANON_KEY`/`SERVICE_ROLE_KEY` and the new `sb_publishable_`/`sb_secret_` keys. Checked on the pinned release: the app's calls work with either pair in `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`/`SUPABASE_SECRET_KEY` (sign-in, row-level security, admin calls, the private bucket). Use the new keys, which is what `setup.sh` writes.

### Running the end-to-end checks

`check-backend` and `check-ui` click email links from a Mailpit inbox (`MAILPIT_URL`, by default the local Supabase CLI's). Against Docker, on a test server, send the stack's email to a Mailpit container and open sign-up while they run:

```bash
docker run -d --name mailpit --network "$(docker network ls -q -f name=_default | head -n 1)" \
  -e MP_SMTP_AUTH_ACCEPT_ANY=1 -e MP_SMTP_AUTH_ALLOW_INSECURE=1 -p 127.0.0.1:8025:8025 axllent/mailpit
SMTP_HOST=mailpit SMTP_PORT=1025 SMTP_USER=test SMTP_PASS=test SMTP_ADMIN_EMAIL=test@example.com sh scripts/setup.sh < /dev/null
# set DISABLE_SIGNUP=false and DEMO_MODE=true in .env (the checks use the demo workspace), then
docker compose up -d
MAILPIT_URL=http://127.0.0.1:8025 node --env-file=.env scripts/check-backend.mjs https://$DOMAIN
```

(`docker network ls` shows the stack's network, `<folder>_default`, if the filter picks the wrong one.) `check-ui` takes the same `MAILPIT_URL`, and counts Vault rows with `psql`: set `DB_URL=postgresql://postgres.<POOLER_TENANT_ID>:<POSTGRES_PASSWORD>@127.0.0.1:5432/postgres`. Its "no SMTP_URL" step starts the local build (`npm run build`, same `NEXT_PUBLIC_*` values) on `http://127.0.0.1:3100`.

`check-selfhost` probes the gateway and Postgres ports on the server's own addresses and on `DOMAIN`; behind NAT, set `PUBLIC_HOST` to the public IP. The output lists what it probed.
