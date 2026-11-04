# Supabase self-hosted (Docker) per Changelark

Ricerca del 2026-11-04. Fonti: solo primarie (supabase.com/docs, `github.com/supabase/supabase/tree/master/docker`, repo dei singoli servizi). Le versioni delle immagini sono quelle di `master` a questa data e cambiano spesso.

## TL;DR

Sì: Changelark può girare per intero su Supabase self-hosted via Docker con le stesse funzioni. Il codice non usa nulla che sia solo cloud (niente Edge Functions, pg_cron, pg_net, OAuth, Management API o branching). Servono però alcune configurazioni da fare a mano.

**Funziona senza modifiche**
- Postgres, RLS, funzioni SQL, `gen_random_uuid()`: le 8 migration in `supabase/migrations/`.
- Vault: `vault.create_secret`, `vault.update_secret`, `vault.decrypted_secrets` (chiavi App Store Connect e Google Play).
- Realtime Postgres Changes sul canale `dashboard`. La publication `supabase_realtime` esiste già nell'immagine.
- Storage: bucket privato `screenshots`, policy su `storage.objects`, `createSignedUrl`. Il backend predefinito è il filesystem locale.
- Auth email e password, `auth.admin.*` con la secret key.
- Chiavi nuove `sb_publishable_*` e `sb_secret_*`. Il self-hosted le supporta, ma vanno generate.

**Funziona con configurazione**
- **Chiavi API**: bisogna lanciare `utils/add-new-auth-keys.sh`. Senza, il gateway accetta solo le chiavi legacy `ANON_KEY`/`SERVICE_ROLE_KEY`, e l'app usa solo le chiavi nuove.
- **Template email**: `config.toml` e `supabase/templates/*.html` **non vengono letti** dal self-hosted. I template vanno serviti via URL (`GOTRUE_MAILER_TEMPLATES_*`). Senza i template custom il link `/auth/confirm?token_hash=…` dell'app non viene generato.
- **SMTP**: va configurato un SMTP vero (`SMTP_HOST`…) per Auth. A parte serve `SMTP_URL` per i digest dell'app.
- **URL**: `SITE_URL`, `ADDITIONAL_REDIRECT_URLS`, `API_EXTERNAL_URL`, `SUPABASE_PUBLIC_URL`. Per avere la conferma email obbligatoria, `ENABLE_EMAIL_AUTOCONFIRM=false`.
- **HTTPS e dominio**: tramite gli override Caddy o Nginx inclusi.
- **Cron dell'app**: oggi girano su Vercel (`vercel.json`). Fuori da Vercel serve uno scheduler esterno.
- **Backup**: vanno fatti a mano. Bisogna salvare anche la chiave root di pgsodium, altrimenti i segreti nel Vault diventano illeggibili.

**Non funziona o non c'è in self-hosted** (Changelark non usa nessuna di queste cose)
- Branching, backup gestiti e PITR, Management API, ETL, analytics e vector bucket, metriche avanzate.
- Studio con più organizzazioni o progetti: c'è un solo progetto.
- Migrazione Cloud verso self-hosted dei segreti Vault: si porta anche la chiave root, altrimenti i segreti non si decifrano più.

---

## 1. Servizi inclusi nel docker-compose ufficiale

Da [`docker/docker-compose.yml`](https://github.com/supabase/supabase/blob/master/docker/docker-compose.yml):

| Servizio | Immagine |
|---|---|
| `studio` | `supabase/studio:2026.10.12-sha-3699278` |
| `api-gw` (gateway) | `envoyproxy/envoy:v1.39.1`. Kong resta disponibile tramite `docker-compose.kong.yml` ([cartella docker](https://github.com/supabase/supabase/tree/master/docker)). |
| `auth` | `supabase/gotrue:v2.197.0` |
| `rest` | `postgrest/postgrest:v14.18` |
| `realtime` | `supabase/realtime:v2.143.3` |
| `storage` | `supabase/storage-api:v1.81.0` |
| `imgproxy` | `darthsim/imgproxy:v3.31.4` |
| `meta` | `supabase/postgres-meta:v0.100.0` |
| `functions` (Edge Runtime) | `supabase/edge-runtime:v1.77.4` |
| `db` | `supabase/postgres:17.6.1.136`. Gli override `pg15` e `pg17` sono nella [cartella docker](https://github.com/supabase/supabase/tree/master/docker). |
| `supavisor` (pooler) | `supabase/supavisor:2.9.13` |

- Logs e Analytics (Logflare e Vector) **non** sono nella configurazione predefinita. Si attivano con `sh run.sh config add logs`, che aggiunge `docker-compose.logs.yml` ([guida Docker](https://supabase.com/docs/guides/self-hosting/docker#enabling-analytics)).
- Si possono togliere i servizi che non servono: Realtime, Storage, imgproxy e functions sono rimovibili ([guida Docker, requisiti](https://supabase.com/docs/guides/self-hosting/docker#system-requirements)). Changelark non usa `functions`, quindi può toglierlo.
- La [cartella docker](https://github.com/supabase/supabase/tree/master/docker) contiene anche altri override: `s3`, `rustfs`, `caddy`, `nginx`, `envoy`, `kong`, `pgbouncer`. Gli script sono `setup.sh`, `run.sh`, `update.sh` e `reset.sh`.

## 2. Vault

- **Estensione presente nell'immagine.** Lo schema di riferimento dell'immagine Postgres crea `supabase_vault` di default: `CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault` ([supabase/postgres `migrations/schema-17.sql`](https://github.com/supabase/postgres/blob/develop/migrations/schema-17.sql)). Il README dell'immagine elenca "pgsodium, vault" tra le estensioni di sicurezza ([supabase/postgres README](https://github.com/supabase/postgres/blob/develop/README.md)). Anche il README del Vault dice "The Vault extension is enabled by default" ([supabase/vault README](https://github.com/supabase/vault/blob/main/README.md)).
- **Stessa API.** `vault.secrets` contiene i dati cifrati. La lettura passa dalla view `vault.decrypted_secrets`, che usa una chiave non accessibile da SQL ([supabase/vault README](https://github.com/supabase/vault/blob/main/README.md)). È la stessa estensione del cloud, quindi `create_secret`, `update_secret` e `decrypted_secrets` si comportano allo stesso modo ([doc Vault](https://supabase.com/docs/guides/database/vault)).
- **Chiave root in self-hosted.** Sul cloud la chiave viene "creata e gestita da Supabase nei sistemi di backend", fuori dal database ([doc Vault, "Where is the key stored?"](https://supabase.com/docs/guides/database/vault)). Nell'immagine self-hosted la genera lo script `pgsodium_getkey`: alla prima esecuzione scrive 32 byte casuali in `/etc/postgresql-custom/pgsodium_root.key` e poi li rilegge sempre da lì ([supabase/postgres `pgsodium_getkey_urandom.sh.j2`](https://github.com/supabase/postgres/blob/develop/ansible/files/pgsodium_getkey_urandom.sh.j2)). Il compose monta un volume con nome apposta: "Use named volume to persist pgsodium decryption key between restarts", cioè `db-config:/etc/postgresql-custom` ([docker-compose.yml](https://github.com/supabase/supabase/blob/master/docker/docker-compose.yml)).
  - **Conseguenza (mia deduzione dalle due fonti sopra):** se perdi il volume `db-config` o fai un dump e restore su un'istanza nuova, i segreti in `vault.secrets` non si decifrano più. Lo stesso vale tra progetti cloud: un nuovo progetto creato con `pg_dump`/`pg_restore` "cannot decrypt" i segreti finché non gli copi la chiave root ([doc Vault, Key portability](https://supabase.com/docs/guides/database/vault#key-portability-and-migration)). Per portare segreti dal cloud al self-hosted bisogna leggere la chiave hex di 64 caratteri dall'endpoint Management API `pgsodium` ([doc Vault](https://supabase.com/docs/guides/database/vault#key-portability-and-migration)) e scriverla in `pgsodium_root.key` prima del restore. Questo ultimo passaggio non è documentato ufficialmente per il self-hosted.
- `VAULT_ENC_KEY` in `.env` **non** è la chiave del Vault di Postgres. È la chiave con cui Supavisor cifra la propria configurazione ([`.env.example`](https://github.com/supabase/supabase/blob/master/docker/.env.example)).

## 3. Realtime

- Il servizio Realtime è nel compose. Il nome del container (`realtime-dev.supabase-realtime`) è voluto, perché "realtime constructs tenant id by parsing the subdomain". Il compose imposta `SEED_SELF_HOST: "true"`, `SECRET_KEY_BASE` e `DB_ENC_KEY` ([docker-compose.yml](https://github.com/supabase/supabase/blob/master/docker/docker-compose.yml)). L'endpoint esposto è `http://<dominio>:8000/realtime/v1/` ([guida Docker](https://supabase.com/docs/guides/self-hosting/docker#accessing-supabase-services)).
- Broadcast, Presence e Postgres Changes sono le tre funzioni del server Realtime open source ([supabase/realtime README](https://github.com/supabase/realtime/blob/main/README.md)). La documentazione di [Broadcast](https://supabase.com/docs/guides/realtime/broadcast) e di [Postgres Changes](https://supabase.com/docs/guides/realtime/postgres-changes) non segnala limiti specifici del self-hosted.
- **Postgres Changes** richiede che le tabelle siano nella publication `supabase_realtime` ([doc Postgres Changes](https://supabase.com/docs/guides/realtime/postgres-changes)). La publication esiste già nello schema dell'immagine ([schema-17.sql](https://github.com/supabase/postgres/blob/develop/migrations/schema-17.sql)), quindi gli `alter publication supabase_realtime add table …` delle migration funzionano così come sono.
- Configurazione da fare: segreti JWT e chiavi (vedi §6). Oltre a quelli, `SECRET_KEY_BASE` e `REALTIME_DB_ENC_KEY` in `.env` ([`.env.example`](https://github.com/supabase/supabase/blob/master/docker/.env.example)), che `utils/generate-keys.sh` genera ([guida Docker, Generate keys](https://supabase.com/docs/guides/self-hosting/docker#generate-keys-and-secrets)).

## 4. Storage

- **Backend predefinito: filesystem.** Il compose imposta `STORAGE_BACKEND: file` e `FILE_STORAGE_BACKEND_PATH: /var/lib/storage`, con bind mount su `./volumes/storage` ([docker-compose.yml](https://github.com/supabase/supabase/blob/master/docker/docker-compose.yml)). La guida conferma: "By default … all files are stored locally on your server filesystem". Si può passare a un backend S3-compatibile (AWS S3, RustFS, MinIO, R2) ([guida Docker, S3](https://supabase.com/docs/guides/self-hosting/docker#configuring-s3-storage); [Configure S3 Storage](https://supabase.com/docs/guides/self-hosting/self-hosted-s3)).
- **RLS su `storage.objects`.** Storage "is designed to work perfectly with Postgres Row Level Security" e le policy si scrivono su `storage.objects` ([Storage Access Control](https://supabase.com/docs/guides/storage/security/access-control)). Lo schema `storage` fa parte dell'immagine ([init-scripts `00000000000002-storage-schema.sql`](https://github.com/supabase/postgres/tree/develop/migrations/db/init-scripts)).
- **Bucket privati e signed URL.** `createSignedUrl` genera URL a tempo per i bucket privati ([Serving assets](https://supabase.com/docs/guides/storage/serving/downloads#signing-urls)). Il servizio è lo stesso `storage-api` open source ([supabase/storage](https://github.com/supabase/storage)). Gli URL firmati usano `STORAGE_PUBLIC_URL=${SUPABASE_PUBLIC_URL}` ([docker-compose.yml](https://github.com/supabase/supabase/blob/master/docker/docker-compose.yml)), quindi `SUPABASE_PUBLIC_URL` deve essere il dominio pubblico reale.
- Limite di dimensione predefinito: `FILE_SIZE_LIMIT: 52428800` (50 MB) ([docker-compose.yml](https://github.com/supabase/supabase/blob/master/docker/docker-compose.yml)). Il bucket `screenshots` usa 2 MB, quindi rientra.

## 5. Funzioni solo cloud o diverse in self-hosted

- **Non disponibili:** "branching, advanced metrics beyond logs, managed backups and PITR, analytics and vector buckets, ETL, and the Management API" ([Self-Hosting overview](https://supabase.com/docs/guides/self-hosting#how-self-hosted-supabase-differs)).
- **Studio:** è incluso, ma "runs as a single project … doesn't support multiple organizations or projects". La maggior parte delle impostazioni passa da variabili d'ambiente ([Self-Hosting overview](https://supabase.com/docs/guides/self-hosting#how-self-hosted-supabase-differs)). L'accesso è protetto da `DASHBOARD_USERNAME`/`DASHBOARD_PASSWORD` ([`.env.example`](https://github.com/supabase/supabase/blob/master/docker/.env.example)).
- **pg_cron e pg_net:** l'immagine contiene i trigger `grant_pg_cron_access` e `grant_pg_net_access`, che si attivano quando crei l'estensione ([schema-17.sql](https://github.com/supabase/postgres/blob/develop/migrations/schema-17.sql)). Sono quindi disponibili come estensioni, ma non abilitate di default. Supabase Cron è "a Postgres Module" basato su pg_cron ([doc Cron](https://supabase.com/docs/guides/cron)). La UI Integrations → Cron è una parte di Studio. Changelark non usa nessuna delle due.
- **Email e SMTP di Auth:** "You will need to use a production-ready SMTP server". Si configura con `SMTP_ADMIN_EMAIL`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` e `SMTP_SENDER_NAME` ([guida Docker, email server](https://supabase.com/docs/guides/self-hosting/docker)).
- **Template email:** il template builder della dashboard "does not apply" in self-hosted ([Email Templates](https://supabase.com/docs/guides/auth/auth-email-templates)). Auth "does not read email templates from mounted Docker volumes": ogni template deve essere servito da un URL raggiungibile dal servizio `auth`, impostato con `GOTRUE_MAILER_TEMPLATES_<FLOW>` e `GOTRUE_MAILER_SUBJECTS_<FLOW>` ([Custom email templates](https://supabase.com/docs/guides/self-hosting/custom-email-templates); [CONFIG.md](https://github.com/supabase/supabase/blob/master/docker/CONFIG.md)).
- **Log:** sono disponibili attivando l'override `logs` (Logflare e Vector, Log Explorer in Studio) ([guida Docker](https://supabase.com/docs/guides/self-hosting/docker#enabling-analytics)). Per metriche e osservabilità esiste un progetto della community ([Self-Hosting overview](https://supabase.com/docs/guides/self-hosting#how-self-hosted-supabase-differs)). Non ho trovato documentazione dei "log drains" per il self-hosted.
- **Dominio e HTTPS:** non c'è il "custom domain" del cloud. Ci sono gli override reverse proxy `docker-compose.caddy.yml` e `docker-compose.nginx.yml` ([cartella docker](https://github.com/supabase/supabase/tree/master/docker)), con le variabili `PROXY_DOMAIN` e `CERTBOT_EMAIL` ([`.env.example`](https://github.com/supabase/supabase/blob/master/docker/.env.example)).

## 6. Migration e variabili d'ambiente

- **Applicare le migration:** `supabase db push --db-url <string>` "Pushes to the database specified by the connection string (must be percent-encoded)". Esempio: `supabase db push --db-url "postgres://user:pass@127.0.0.1:5432/postgres"`. Il flag `--dry-run` mostra le migration senza applicarle ([CLI db push](https://supabase.com/docs/reference/cli/supabase-db-push)). In self-hosted la porta 5432 passa da Supavisor e l'utente ha la forma `postgres.<POOLER_TENANT_ID>` ([Restore to self-hosted, Step 5](https://supabase.com/docs/guides/self-hosting/restore-from-platform); porte in [docker-compose.yml](https://github.com/supabase/supabase/blob/master/docker/docker-compose.yml)).
- **Chiavi:**
  - Le chiavi legacy `ANON_KEY` e `SERVICE_ROLE_KEY` sono JWT HS256 firmati con `JWT_SECRET`.
  - Le chiavi nuove `SUPABASE_PUBLISHABLE_KEY` (al posto di `ANON_KEY`, lato client) e `SUPABASE_SECRET_KEY` (al posto di `SERVICE_ROLE_KEY`, lato server) hanno il formato `sb_publishable_…` e `sb_secret_…`, uguale al cloud.
  - Se le variabili nuove sono vuote, "the API gateway and all services operate in legacy-only mode" ([New API Keys, self-hosted](https://supabase.com/docs/guides/self-hosting/self-hosted-auth-keys)).
  - Si generano con `sh utils/generate-keys.sh` e poi `sh utils/add-new-auth-keys.sh` ([guida Docker, Generate keys](https://supabase.com/docs/guides/self-hosting/docker#generate-keys-and-secrets)).
  - I JWT asimmetrici si configurano con `JWT_KEYS` e `JWT_JWKS` ([`.env.example`](https://github.com/supabase/supabase/blob/master/docker/.env.example)). Il JWKS pubblico è su `/auth/v1/.well-known/jwks.json` ([New API Keys](https://supabase.com/docs/guides/self-hosting/self-hosted-auth-keys)).
- **Corrispondenza tra le variabili di Changelark e quelle del `.env` self-hosted** (nomi da [`.env.example`](https://github.com/supabase/supabase/blob/master/docker/.env.example)):

| Changelark | Self-hosted |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `SUPABASE_PUBLIC_URL` (es. `https://db.example.com`, cioè il gateway su `:8000` dietro il proxy) |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | `SUPABASE_PUBLISHABLE_KEY` |
| `SUPABASE_SECRET_KEY` | `SUPABASE_SECRET_KEY` |
| (non usato dall'app) | `JWT_SECRET`, `ANON_KEY`, `SERVICE_ROLE_KEY` |
| Site URL e redirect di Auth (oggi in `config.toml`) | `SITE_URL`, `ADDITIONAL_REDIRECT_URLS`, `API_EXTERNAL_URL` |
| `enable_confirmations = true` | `ENABLE_EMAIL_AUTOCONFIRM=false` |

## 7. Aggiornamenti e backup

- **Aggiornare:** `sh update.sh --dry-run`, poi `sh update.sh`, poi `sh run.sh pull && sh run.sh recreate` ([docker/README.md](https://github.com/supabase/supabase/blob/master/docker/README.md)). Lo script usa un three-way merge che conserva segreti e modifiche locali. Prima di cambiare file mostra i passaggi manuali richiesti dai breaking change, per esempio un upgrade major di Postgres, letti da `upgrades.json` ([Update your deployment](https://supabase.com/docs/guides/self-hosting/updating)). Lo storico delle versioni per i rollback è in [versions.md](https://github.com/supabase/supabase/blob/master/docker/versions.md).
- **Backup:** "`update.sh` backs up your configuration files … but it does not back up Postgres or Storage data. Back those up separately first" ([Update your deployment](https://supabase.com/docs/guides/self-hosting/updating#before-you-start)). Backup gestiti e PITR non sono disponibili ([Self-Hosting overview](https://supabase.com/docs/guides/self-hosting#how-self-hosted-supabase-differs)). Per portare un database dal cloud al self-hosted esiste una guida ufficiale, che però non copre gli oggetti Storage e le Edge Functions ([Restore a Platform Project to Self-Hosted](https://supabase.com/docs/guides/self-hosting/restore-from-platform)).
- **Cosa salvare per Changelark** (deduzione dalle sezioni 2 e 4):
  - il dump di Postgres;
  - `./volumes/storage`, cioè gli screenshot;
  - il volume `db-config`, cioè `pgsodium_root.key`, senza il quale le chiavi ASC e Play nel Vault sono perse;
  - il file `.env`.

---

## Impatto su Changelark

Ho cercato nelle migration, in `lib/`, `app/`, `components/` e `scripts/`. Non ho aperto i file `.env*`.

| Funzione usata | Dove | Self-hosted |
|---|---|---|
| Vault (`create_secret`, `update_secret`, `decrypted_secrets`, `delete from vault.secrets`) | `supabase/migrations/20261103221347_app_store_connect.sql`, `supabase/migrations/20261103222721_app_proofs.sql`, `components/dashboard.tsx` (UI), `scripts/check-ui.mjs` (conta i segreti via `psql`) | Funziona. **Bisogna fare il backup del volume `db-config`.** Se un'istanza arriva dal cloud, va copiata la chiave root. |
| Realtime Postgres Changes (`sb.channel("dashboard")`, `postgres_changes` su `comments`, `reports`, `releases`, `bug_reports`) | `lib/store.ts:168-169`, `supabase/migrations/20261103211052_realtime_dashboard.sql`, `supabase/migrations/20261104140000_feedback_loop.sql:38` | Funziona: la publication esiste. Broadcast e Presence non sono usati. |
| Storage: bucket privato `screenshots` (2 MB, png e jpeg), policy su `storage.objects`, `createSignedUrl`, `remove` | `supabase/migrations/20261104140000_feedback_loop.sql:42-46`, `lib/store.ts:380,385`, `scripts/check-backend.mjs:248,253` | Funziona sul backend `file`. `SUPABASE_PUBLIC_URL` deve essere il dominio reale, altrimenti i signed URL puntano all'host sbagliato. |
| Auth email e password: `signUp`, `signInWithPassword`, reset, conferma con `token_hash` | `lib/store.ts`, `components/auth.tsx`, `app/auth/confirm/route.ts` | **Richiede configurazione.** Sotto ci sono i dettagli. |
| Template email custom (`{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}`) | `supabase/templates/confirmation.html`, `supabase/templates/recovery.html`, `supabase/config.toml:251-257` | **Non applicati in self-hosted.** Bisogna servirli via HTTP e impostare `GOTRUE_MAILER_TEMPLATES_CONFIRMATION`, `GOTRUE_MAILER_TEMPLATES_RECOVERY` e i relativi `GOTRUE_MAILER_SUBJECTS_*`. Senza, le email usano il link predefinito `/auth/v1/verify` e non la rotta `/auth/confirm` dell'app. |
| `auth.admin.*` (createUser, listUsers, updateUserById, getUserById, deleteUser) | `app/api/demo/route.ts`, `app/api/account/route.ts`, `app/api/cron/alerts/route.ts`, `scripts/check-proofs.mjs` | Funziona con `SUPABASE_SECRET_KEY`. Serve `add-new-auth-keys.sh`. |
| Chiavi nuove `sb_publishable_` e `sb_secret_` | `lib/supabase.ts:9`, `lib/server.ts:9-23`, `scripts/check-backend.mjs:12-13` | **Richiede configurazione:** senza `add-new-auth-keys.sh` l'istanza accetta solo le chiavi legacy e l'app non si connette. In alternativa si possono passare `ANON_KEY` e `SERVICE_ROLE_KEY` nelle stesse variabili, perché supabase-js accetta entrambe. Non l'ho verificato. |
| Cron `/api/cron/asc-sync` e `/api/cron/alerts` | `vercel.json`, `app/api/cron/*` | Non dipende da Supabase. Fuori da Vercel servono un `crontab` o un altro scheduler con `Authorization: Bearer $CRON_SECRET`, come dice già il `README.md`. pg_cron non è usato: c'è solo un commento `ponytail:` in `20261103222518_rate_limits.sql:24`. |
| Email digest (`SMTP_URL`) | `lib/mail.ts`, `app/api/cron/alerts/route.ts` | È indipendente da Supabase. Va comunque configurato a parte rispetto all'SMTP di Auth. |
| OAuth (Apple) | `supabase/config.toml:337` | `enabled = false`, non usato. |
| Edge Functions, pg_net, Management API, branching | nessuno | Non usati. Il servizio `functions` si può togliere dal compose. |
| `gen_random_uuid()`, RLS, funzioni `security definer` | tutte le migration | Postgres standard, funziona. |

**Nessun blocco.** Le cose da documentare per chi fa self-hosting, per esempio in una sezione "Self-host" del `README.md`:
1. Lanciare `generate-keys.sh` e `add-new-auth-keys.sh`, poi mettere `SUPABASE_PUBLISHABLE_KEY` e `SUPABASE_SECRET_KEY` nelle variabili dell'app.
2. Impostare `SITE_URL`, `ADDITIONAL_REDIRECT_URLS` e `ENABLE_EMAIL_AUTOCONFIRM=false` e configurare l'SMTP di Auth.
3. Servire i due template di `supabase/templates/` (ora in `public/email-templates/`) e impostare `GOTRUE_MAILER_TEMPLATES_CONFIRMATION`/`RECOVERY` e i relativi `SUBJECTS`.
4. Applicare lo schema con `npx supabase db push --db-url "postgres://postgres.<tenant>:<pwd>@<host>:5432/postgres"`.
5. Configurare uno scheduler per le due rotte cron.
6. Fare i backup: dump di Postgres, `volumes/storage`, volume `db-config` (chiave del Vault) e `.env`.
