-- Changelark schema.
-- Developers (signed in) manage their own apps, releases and moderation through the Data API, guarded by RLS.
-- Anonymous visitors and in-app SDK installs never touch the Data API: they go through the Next.js
-- /api/v1/sdk routes, which use the server-only secret key and identify a device by a hashed install id.

create schema if not exists private;

-- ---------- tables ----------

create table public.apps (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  slug text not null unique
    check (slug ~ '^[a-z0-9][a-z0-9-]{0,79}$'
      and slug not in ('api', 'about', 'docs', 'login', 'signup', 'dashboard', 'changelog', 'sdk', 'agents', '_next')),
  name text not null check (length(btrim(name)) between 1 and 200),
  description text not null default '' check (length(description) <= 5000),
  store_url text not null default '' check (length(store_url) <= 500),
  contact text not null default '' check (length(contact) <= 500),
  color text not null default '#007AFF' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  key text not null unique check (key ~ '^clk_[a-z0-9]{10,40}$'),
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index apps_owner_id_idx on public.apps (owner_id);

create table public.releases (
  id uuid primary key default gen_random_uuid(),
  app_id uuid not null references public.apps (id) on delete cascade,
  version text not null check (version ~ '^\d+(\.\d+){0,3}$'),
  notes text not null default '' check (length(notes) <= 20000),
  release_date date not null default current_date,
  published boolean not null default false,
  up_count integer not null default 0,
  down_count integer not null default 0,
  created_at timestamptz not null default now(),
  unique (app_id, version)
);

create table public.comments (
  id uuid primary key default gen_random_uuid(),
  release_id uuid not null references public.releases (id) on delete cascade,
  parent_id uuid references public.comments (id) on delete cascade,
  body text not null check (length(body) <= 1000),
  author_name text not null check (length(author_name) between 1 and 120),
  is_dev boolean not null default false,
  -- sha256 of the device's install id; null for developer replies. The raw id is never stored.
  author_tag text,
  hidden boolean not null default false,
  deleted boolean not null default false,
  up_count integer not null default 0,
  down_count integer not null default 0,
  created_at timestamptz not null default now()
);
create index comments_release_id_idx on public.comments (release_id);
create index comments_parent_id_idx on public.comments (parent_id);
create index comments_author_tag_created_idx on public.comments (author_tag, created_at);

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  comment_id uuid not null references public.comments (id) on delete cascade,
  reason text not null default 'abuse' check (reason in ('spam', 'abuse', 'off-topic')),
  reporter_tag text not null,
  created_at timestamptz not null default now(),
  unique (comment_id, reporter_tag)
);
create index reports_reporter_tag_idx on public.reports (reporter_tag);

create table public.votes (
  id bigint generated always as identity primary key,
  voter_tag text not null,
  release_id uuid references public.releases (id) on delete cascade,
  comment_id uuid references public.comments (id) on delete cascade,
  value smallint not null check (value in (-1, 1)),
  check (num_nonnulls(release_id, comment_id) = 1),
  unique nulls not distinct (voter_tag, release_id, comment_id)
);
create index votes_release_id_idx on public.votes (release_id);
create index votes_comment_id_idx on public.votes (comment_id);

-- Per-device, per-app settings: guidelines accepted, people blocked.
create table public.installs (
  app_id uuid not null references public.apps (id) on delete cascade,
  device_tag text not null,
  guidelines_accepted_at timestamptz,
  blocked_tags text[] not null default '{}',
  primary key (app_id, device_tag)
);

-- ---------- vote counters ----------
-- Counts are kept on the row so lists don't aggregate. Each change is a single-row increment, safe under concurrency.

create function private.apply_vote() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  d_up integer := 0;
  d_down integer := 0;
  r record;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    if old.value = 1 then d_up := d_up - 1; else d_down := d_down - 1; end if;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    if new.value = 1 then d_up := d_up + 1; else d_down := d_down + 1; end if;
  end if;
  r := coalesce(new, old);
  if r.release_id is not null then
    update public.releases set up_count = up_count + d_up, down_count = down_count + d_down where id = r.release_id;
  else
    update public.comments set up_count = up_count + d_up, down_count = down_count + d_down where id = r.comment_id;
  end if;
  return null;
end;
$$;

create trigger votes_apply after insert or update or delete on public.votes
  for each row execute function private.apply_vote();

-- ---------- ownership helpers for RLS ----------
-- security definer so policies don't re-run RLS on every lookup; each checks the caller's own id.

create function private.owns_app(p_app uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.apps where id = p_app and owner_id = (select auth.uid()));
$$;

create function private.owns_release(p_release uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.releases r join public.apps a on a.id = r.app_id
    where r.id = p_release and a.owner_id = (select auth.uid())
  );
$$;

create function private.owns_comment(p_comment uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.comments c
    join public.releases r on r.id = c.release_id
    join public.apps a on a.id = r.app_id
    where c.id = p_comment and a.owner_id = (select auth.uid())
  );
$$;

revoke all on schema private from public, anon;
grant usage on schema private to authenticated;
revoke execute on all functions in schema private from public, anon;
grant execute on function private.owns_app(uuid), private.owns_release(uuid), private.owns_comment(uuid) to authenticated;

-- ---------- privileges ----------
-- anon gets nothing: public pages and the SDK go through the server.
-- authenticated gets only the columns a developer may change; counters and device tags are server-only.

revoke all on public.apps, public.releases, public.comments, public.reports, public.votes, public.installs from anon, authenticated;

grant select, delete on public.apps to authenticated;
grant insert (slug, name, description, store_url, contact, color, key) on public.apps to authenticated;
grant update (name, description, store_url, contact, color, key, synced_at) on public.apps to authenticated;

grant select, delete on public.releases to authenticated;
grant insert (app_id, version, notes, release_date, published) on public.releases to authenticated;
grant update (notes, release_date, published) on public.releases to authenticated;

grant select on public.comments to authenticated;
grant insert (release_id, parent_id, body, author_name, is_dev) on public.comments to authenticated;
grant update (hidden) on public.comments to authenticated;

grant select, delete on public.reports to authenticated;

grant all on public.apps, public.releases, public.comments, public.reports, public.votes, public.installs to service_role;

-- ---------- row level security ----------

alter table public.apps enable row level security;
alter table public.releases enable row level security;
alter table public.comments enable row level security;
alter table public.reports enable row level security;
alter table public.votes enable row level security;
alter table public.installs enable row level security;

create policy "owners read their apps" on public.apps for select to authenticated
  using ((select auth.uid()) = owner_id);
create policy "owners add apps" on public.apps for insert to authenticated
  with check ((select auth.uid()) = owner_id);
create policy "owners edit their apps" on public.apps for update to authenticated
  using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
create policy "owners remove their apps" on public.apps for delete to authenticated
  using ((select auth.uid()) = owner_id);

create policy "owners read releases" on public.releases for select to authenticated
  using ((select private.owns_app(app_id)));
create policy "owners add releases" on public.releases for insert to authenticated
  with check ((select private.owns_app(app_id)));
create policy "owners edit releases" on public.releases for update to authenticated
  using ((select private.owns_app(app_id))) with check ((select private.owns_app(app_id)));
create policy "owners remove releases" on public.releases for delete to authenticated
  using ((select private.owns_app(app_id)));

create policy "owners read comments" on public.comments for select to authenticated
  using ((select private.owns_release(release_id)));
-- Developers only post as the developer; anonymous comments come through the server.
create policy "owners reply as developer" on public.comments for insert to authenticated
  with check (is_dev and (select private.owns_release(release_id)));
create policy "owners hide comments" on public.comments for update to authenticated
  using ((select private.owns_release(release_id))) with check ((select private.owns_release(release_id)));

create policy "owners read reports" on public.reports for select to authenticated
  using ((select private.owns_comment(comment_id)));
create policy "owners dismiss reports" on public.reports for delete to authenticated
  using ((select private.owns_comment(comment_id)));

-- votes and installs: no policies, so only the server (secret key) can reach them.
