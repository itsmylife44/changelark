#!/bin/sh
# Sets up Changelark with self-hosted Supabase: generates every secret and the sb_ API keys
# with Supabase's own scripts, then writes .env. Safe to run again: a value already in
# .env is never changed, only missing ones are added. Then it starts the stack and creates
# the first account (sign-up stays closed); with an account already there it does nothing.
#
#   sh scripts/setup.sh                  # asks for the domain, SMTP (optional), email and password
#   DOMAIN=changelark.example.com ADMIN_EMAIL=me@example.com ADMIN_PASSWORD=... sh scripts/setup.sh
#
# Needs curl, openssl and node (or docker).
set -eu
cd "$(dirname "$0")/.."
ENV_FILE=${SETUP_TEST_ENV_FILE:-.env} # tests only: the stack always reads ./.env
SITE_ROOT=$(pwd)
case $ENV_FILE in /*) ;; *) ENV_FILE=$SITE_ROOT/$ENV_FILE ;; esac
touch "$ENV_FILE"

has() { grep -q "^$1=" "$ENV_FILE"; }
get() { grep "^$1=" "$ENV_FILE" | head -n 1 | cut -d= -f2-; }

# Keys of another Supabase (usually Cloud) would silently win over the new ones.
if ! has JWT_KEYS; then
  for k in NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY SUPABASE_SECRET_KEY; do
    if has "$k"; then
      echo "$ENV_FILE already has $k, from another Supabase project. To switch to self-hosted, remove the NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY lines and run this again." >&2
      exit 1
    fi
  done
fi

domain=${DOMAIN:-$(get DOMAIN)}
if [ -z "$domain" ]; then
  if [ ! -t 0 ]; then echo "Set DOMAIN, e.g. DOMAIN=changelark.example.com sh scripts/setup.sh" >&2; exit 1; fi
  printf "Domain for Changelark (e.g. changelark.example.com): "
  read -r domain
  [ -n "$domain" ] || exit 1
fi
url=https://$domain

# SMTP, optional: Auth's confirmation and reset emails, and the app's email alerts. Asked
# until .env has it; SMTP_HOST=... in the environment sets or replaces it.
smtp_host=${SMTP_HOST:-} smtp_port=${SMTP_PORT:-} smtp_user=${SMTP_USER:-} smtp_pass=${SMTP_PASS:-} smtp_from=${SMTP_ADMIN_EMAIL:-}
if [ -z "$smtp_host" ] && ! has SMTP_URL && [ -t 0 ]; then
  printf "SMTP server for email, e.g. smtp.resend.com (Enter to skip; run this again to add it later): "
  read -r smtp_host
  if [ -n "$smtp_host" ]; then
    printf "SMTP port [587]: "; read -r smtp_port
    printf "SMTP user: "; read -r smtp_user
    stty -echo; printf "SMTP password: "; read -r smtp_pass; stty echo; echo
    printf "Sender address (e.g. hello@%s): " "$domain"; read -r smtp_from
  fi
fi
if [ -n "$smtp_host" ]; then
  smtp_port=${smtp_port:-587}
  if [ -z "$smtp_user" ] || [ -z "$smtp_pass" ] || [ -z "$smtp_from" ]; then
    echo "SMTP needs a user, a password and a sender address (SMTP_USER, SMTP_PASS, SMTP_ADMIN_EMAIL)." >&2; exit 1
  fi
  case $smtp_host$smtp_user$smtp_pass in *"'"*) echo "The SMTP server, user and password can't contain a single quote (')." >&2; exit 1 ;; esac
fi

# Supabase's scripts and defaults, from the release pinned in docker-compose.supabase.yml.
tag=$(sed -n 's|.*supabase\.git#\([^:]*\):docker/.*|\1|p' docker-compose.supabase.yml)
raw=https://raw.githubusercontent.com/supabase/supabase/$tag/docker
tmp=$(mktemp -d)
trap 'rm -r "$tmp"; [ ! -t 0 ] || stty echo' EXIT
cd "$tmp"
curl -fsSL "$raw/.env.example" -o defaults
curl -fsSL "$raw/utils/generate-keys.sh" -o generate-keys.sh
curl -fsSL "$raw/utils/add-new-auth-keys.sh" -o add-new-auth-keys.sh

sh generate-keys.sh </dev/null | grep -E '^[A-Z_0-9]+=' > keys
# Keys signed with JWT_SECRET only make sense next to the secret that signed them.
if has JWT_SECRET; then grep -vE '^(JWT_SECRET|ANON_KEY|SERVICE_ROLE_KEY)=' keys > k && mv k keys; fi
jwt=$(get JWT_SECRET)
[ -n "$jwt" ] || jwt=$(grep '^JWT_SECRET=' keys | cut -d= -f2-)

if ! has JWT_KEYS; then
  # add-new-auth-keys.sh reads ./.env and edits ./docker-compose.yml; give it scratch copies.
  # The services' side of what it edits is in supabase/compose.override.yml.
  printf 'JWT_SECRET=%s\n' "$jwt" > .env
  : > docker-compose.yml
  sh add-new-auth-keys.sh --update-env </dev/null >/dev/null
  grep -E '^(SUPABASE_PUBLISHABLE_KEY|SUPABASE_SECRET_KEY|ANON_KEY_ASYMMETRIC|SERVICE_ROLE_KEY_ASYMMETRIC|JWT_KEYS|JWT_JWKS)=' .env >> keys
  grep -q '^SUPABASE_SECRET_KEY=sb_secret_' keys || { echo "add-new-auth-keys.sh did not produce the sb_ keys" >&2; exit 1; }
fi
pub=$(get SUPABASE_PUBLISHABLE_KEY)
[ -n "$pub" ] || pub=$(grep '^SUPABASE_PUBLISHABLE_KEY=' keys | cut -d= -f2-)

# First line for a key wins: Changelark's values, then the generated secrets, then Supabase's defaults.
{
  echo "COMPOSE_FILE=docker-compose.yml:docker-compose.supabase.yml"
  echo "COMPOSE_PROFILES=caddy"
  echo "DOMAIN=$domain"
  echo "NEXT_PUBLIC_SUPABASE_URL=$url"
  echo "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=$pub"
  echo "SITE_URL=$url"
  echo "API_EXTERNAL_URL=$url"
  echo "SUPABASE_PUBLIC_URL=$url"
  echo "ADDITIONAL_REDIRECT_URLS=$url/**"
  echo "CRON_SECRET=$(openssl rand -hex 32)"
  echo "ENABLE_EMAIL_AUTOCONFIRM=true" # no SMTP yet, so nobody could confirm an email
  echo "DISABLE_SIGNUP=true" # the first account comes from this script
  cat keys
  grep -E '^[A-Z_0-9]+=' defaults
} > candidates
awk -F= -v env="$ENV_FILE" 'FILENAME == env { have[$1] = 1; next } !have[$1]++' "$ENV_FILE" candidates > added

if [ -s added ]; then
  { echo ""; echo "# Added by scripts/setup.sh on $(date +%Y-%m-%d)"; cat added; } >> "$ENV_FILE"
  echo "Added $(wc -l < added | tr -d ' ') settings to $ENV_FILE."
else
  echo "$ENV_FILE already has every setting; nothing changed."
fi

# With SMTP, only the email settings are replaced; everything else in .env stays.
if [ -n "$smtp_host" ]; then
  enc() { printf '%s' "$1" | od -An -tx1 -v | tr -d ' \n' | sed 's/../%&/g'; }
  scheme=smtp; [ "$smtp_port" != 465 ] || scheme=smtps # 465 is TLS from the start
  {
    echo "ENABLE_EMAIL_AUTOCONFIRM=false"
    echo "SMTP_HOST='$smtp_host'" # quoted, so Docker Compose leaves a $ in them alone
    echo "SMTP_PORT=$smtp_port"
    echo "SMTP_USER='$smtp_user'"
    echo "SMTP_PASS='$smtp_pass'"
    echo "SMTP_ADMIN_EMAIL=$smtp_from"
    echo "SMTP_SENDER_NAME=Changelark"
    echo "SMTP_URL=$scheme://$(enc "$smtp_user"):$(enc "$smtp_pass")@$smtp_host:$smtp_port"
    echo "EMAIL_FROM=Changelark <$smtp_from>"
  } > smtp
  awk -F= 'NR == FNR { drop[$1] = 1; next } !drop[$1]' smtp "$ENV_FILE" > kept
  { cat kept; echo ""; echo "# Email, set by scripts/setup.sh on $(date +%Y-%m-%d)"; cat smtp; } > "$ENV_FILE"
  echo "Email goes through $smtp_host; new accounts confirm their address. If the stack is already up, apply it with: docker compose up -d"
fi

# First account, made with Auth's admin API through the gateway on 127.0.0.1. The
# password is only sent to Auth, never written to .env.
email=${ADMIN_EMAIL:-}
if [ -z "$email" ] && [ ! -t 0 ]; then
  echo "Next: docker compose up -d --build. To create the first account, run this again in a terminal, or with ADMIN_EMAIL=... ADMIN_PASSWORD=..."
  exit 0
fi
api=http://127.0.0.1:$(get KONG_HTTP_PORT)/auth/v1
# The secret key goes to curl in a file, so it doesn't show up in the process list.
printf 'apikey: %s\n' "$(get SUPABASE_SECRET_KEY)" > admin-headers
healthy() { curl -fs -o /dev/null -H "apikey: $pub" "$api/health"; }
if healthy && curl -fsS -H @admin-headers "$api/admin/users?per_page=1" | grep -q '"email"'; then
  echo "Changelark already has an account; left as is."
  exit 0
fi

if [ -z "$email" ]; then
  printf "Email for your Changelark account: "
  read -r email
fi
password=${ADMIN_PASSWORD:-}
if [ -z "$password" ]; then
  if [ ! -t 0 ]; then echo "Set ADMIN_PASSWORD too, or run this again in a terminal." >&2; exit 1; fi
  stty -echo; printf "Password (8 characters or more): "; read -r password; stty echo; echo
fi
[ ${#password} -ge 8 ] || { echo "The password needs 8 characters or more." >&2; exit 1; }
case $email$password in *[[:cntrl:]]*) echo "The email and password can't contain control characters (tabs, line breaks)." >&2; exit 1 ;; esac

if ! healthy; then
  echo "Starting the stack (docker compose up -d --build), this takes a few minutes..."
  (cd "$SITE_ROOT" && docker compose up -d --build)
  i=0
  until healthy; do
    i=$((i + 1)); [ $i -le 150 ] || { echo "Auth did not answer at $api; check docker compose logs auth" >&2; exit 1; }
    sleep 2
  done
fi

esc() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'; }
# The body goes through stdin so the password doesn't show up in the process list.
code=$(printf '{"email":"%s","password":"%s","email_confirm":true}' "$(esc "$email")" "$(esc "$password")" |
  curl -sS -o response -w '%{http_code}' -X POST "$api/admin/users" -H @admin-headers -H "content-type: application/json" --data-binary @-)
if [ "$code" = 200 ] || [ "$code" = 201 ]; then
  echo "Created the account $email. Sign in at $url/login."
elif [ "$code" = 422 ] && grep -q email_exists response; then
  echo "$email already has an account; left as is."
else
  echo "Auth answered $code:" >&2; cat response >&2; echo >&2; exit 1
fi
echo "DISABLE_SIGNUP=$(get DISABLE_SIGNUP) in $ENV_FILE. Studio: see docs/self-hosting.md (SSH tunnel)."
