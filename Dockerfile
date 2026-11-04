FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# One-shot migration runner for docker-compose.supabase.yml.
FROM deps AS migrate
COPY supabase ./supabase
ENV PATH=/app/node_modules/.bin:$PATH

# Scheduled jobs (cron/): wget for the app's cron routes, pg_dump and tar for the backup.
# The client matches the Postgres 17 of the pinned Supabase release.
FROM alpine:3 AS cron
RUN apk add --no-cache postgresql17-client tar

FROM deps AS build
COPY . .
# NEXT_PUBLIC_* values are written into the bundle at build time.
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
ARG NEXT_PUBLIC_SITE_URL
ARG NEXT_PUBLIC_SWIFT_PACKAGE_URL
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
USER node
EXPOSE 3000
CMD ["node", "server.js"]
