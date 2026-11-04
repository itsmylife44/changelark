-- App Store Connect import.
-- A developer stores one App Store Connect API key (the .p8 lives encrypted in Supabase Vault, never in a table),
-- links each Changelark app to an App Store app, and versions are imported by the server.

create table public.asc_connections (
  owner_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  issuer_id text not null check (issuer_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  key_id text not null check (key_id ~ '^[A-Z0-9]{10}$'),
  secret_id uuid not null, -- vault.secrets row holding the private key
  last_sync_at timestamptz,
  last_error text,
  created_at timestamptz not null default now()
);

alter table public.asc_connections enable row level security;
revoke all on public.asc_connections from anon, authenticated;
-- Developers can see their connection (not the secret id) and remove it. Saving goes through the server.
grant select (owner_id, issuer_id, key_id, last_sync_at, last_error, created_at) on public.asc_connections to authenticated;
grant delete on public.asc_connections to authenticated;
grant all on public.asc_connections to service_role;
create policy "owners read their connection" on public.asc_connections for select to authenticated
  using ((select auth.uid()) = owner_id);
create policy "owners remove their connection" on public.asc_connections for delete to authenticated
  using ((select auth.uid()) = owner_id);

-- Which App Store app a Changelark app imports from. Set only by the server, after checking the key can see that app.
alter table public.apps add column asc_app_id text check (asc_app_id ~ '^[0-9]{1,20}$');
-- Imported releases can be published automatically when they go live; manual ones are never touched.
alter table public.releases add column source text not null default 'manual' check (source in ('manual', 'app_store'));

-- Vault access, for the server only (service_role). Not callable by anon or signed-in users.
create function public.asc_save_key(p_owner uuid, p_issuer text, p_key_id text, p_private_key text) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_secret uuid;
begin
  select secret_id into v_secret from public.asc_connections where owner_id = p_owner;
  if v_secret is null then
    v_secret := vault.create_secret(p_private_key, 'asc-key-' || p_owner::text, 'App Store Connect API key');
  else
    perform vault.update_secret(v_secret, p_private_key);
  end if;
  insert into public.asc_connections (owner_id, issuer_id, key_id, secret_id)
  values (p_owner, p_issuer, p_key_id, v_secret)
  on conflict (owner_id) do update set issuer_id = excluded.issuer_id, key_id = excluded.key_id, last_error = null;
end;
$$;

create function public.asc_private_key(p_owner uuid) returns text
language sql stable security definer set search_path = ''
as $$
  select s.decrypted_secret
  from public.asc_connections c join vault.decrypted_secrets s on s.id = c.secret_id
  where c.owner_id = p_owner;
$$;

revoke execute on function public.asc_save_key(uuid, text, text, text), public.asc_private_key(uuid) from public, anon, authenticated;
grant execute on function public.asc_save_key(uuid, text, text, text), public.asc_private_key(uuid) to service_role;

-- Disconnecting (or deleting the account) also deletes the stored key.
create function private.asc_forget_key() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  delete from vault.secrets where id = old.secret_id;
  return old;
end;
$$;
revoke execute on function private.asc_forget_key() from public, anon, authenticated;

create trigger asc_connections_forget_key after delete on public.asc_connections
  for each row execute function private.asc_forget_key();
