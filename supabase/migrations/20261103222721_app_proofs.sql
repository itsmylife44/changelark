-- App proofs: when an app requires them, anonymous writes (votes, comments, reports, blocks) must carry
-- an Apple App Attest assertion or a Google Play Integrity token, so only genuine copies of the app can post.

alter table public.apps
  add column proof_mode text not null default 'off' check (proof_mode in ('off', 'required')),
  add column ios_app_id text check (ios_app_id ~ '^[A-Z0-9]{10}\.[A-Za-z0-9.-]+$'), -- TEAMID.bundle.id
  add column ios_attest_env text not null default 'production' check (ios_attest_env in ('production', 'development')),
  add column android_package text check (android_package ~ '^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$');
grant update (proof_mode, ios_app_id, ios_attest_env, android_package) on public.apps to authenticated;

-- One-time challenges handed to a device before it signs a write. Server only.
create table public.attest_challenges (
  challenge text primary key,
  app_id uuid not null references public.apps (id) on delete cascade,
  device_tag text not null,
  expires_at timestamptz not null,
  used boolean not null default false
);
create index attest_challenges_app_id_idx on public.attest_challenges (app_id);
create index attest_challenges_expires_idx on public.attest_challenges (expires_at);

-- App Attest keys registered by devices (public half only). Server only.
create table public.attest_keys (
  app_id uuid not null references public.apps (id) on delete cascade,
  key_id text not null,
  device_tag text not null,
  public_key text not null,
  counter bigint not null default 0,
  created_at timestamptz not null default now(),
  primary key (app_id, key_id)
);

alter table public.attest_challenges enable row level security;
alter table public.attest_keys enable row level security;
revoke all on public.attest_challenges, public.attest_keys from anon, authenticated;
grant all on public.attest_challenges, public.attest_keys to service_role;

-- Google service account (JSON) for Play Integrity, one per developer, kept in Vault like the App Store Connect key.
create table public.play_connections (
  owner_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  client_email text not null,
  secret_id uuid not null,
  created_at timestamptz not null default now()
);
alter table public.play_connections enable row level security;
revoke all on public.play_connections from anon, authenticated;
grant select (owner_id, client_email, created_at) on public.play_connections to authenticated;
grant delete on public.play_connections to authenticated;
grant all on public.play_connections to service_role;
create policy "owners read their play connection" on public.play_connections for select to authenticated
  using ((select auth.uid()) = owner_id);
create policy "owners remove their play connection" on public.play_connections for delete to authenticated
  using ((select auth.uid()) = owner_id);

create function public.play_save_key(p_owner uuid, p_client_email text, p_json text) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_secret uuid;
begin
  select secret_id into v_secret from public.play_connections where owner_id = p_owner;
  if v_secret is null then
    v_secret := vault.create_secret(p_json, 'play-key-' || p_owner::text, 'Google Play Integrity service account');
  else
    perform vault.update_secret(v_secret, p_json);
  end if;
  insert into public.play_connections (owner_id, client_email, secret_id) values (p_owner, p_client_email, v_secret)
  on conflict (owner_id) do update set client_email = excluded.client_email;
end;
$$;

create function public.play_service_account(p_owner uuid) returns text
language sql stable security definer set search_path = ''
as $$
  select s.decrypted_secret
  from public.play_connections c join vault.decrypted_secrets s on s.id = c.secret_id
  where c.owner_id = p_owner;
$$;

revoke execute on function public.play_save_key(uuid, text, text), public.play_service_account(uuid) from public, anon, authenticated;
grant execute on function public.play_save_key(uuid, text, text), public.play_service_account(uuid) to service_role;

create function private.play_forget_key() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  delete from vault.secrets where id = old.secret_id;
  return old;
end;
$$;
revoke execute on function private.play_forget_key() from public, anon, authenticated;
create trigger play_connections_forget_key after delete on public.play_connections
  for each row execute function private.play_forget_key();
