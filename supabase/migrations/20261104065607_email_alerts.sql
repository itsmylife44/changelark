-- Email digest of new comments and reports. One row per developer once they change a setting; no row means alerts are on.

create table public.alert_settings (
  owner_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  email_alerts boolean not null default true,
  last_sent_at timestamptz
);

alter table public.alert_settings enable row level security;
revoke all on public.alert_settings from anon, authenticated;
grant select, insert (owner_id, email_alerts), update (email_alerts) on public.alert_settings to authenticated;
grant all on public.alert_settings to service_role;

create policy "owners read their alert settings" on public.alert_settings for select to authenticated
  using ((select auth.uid()) = owner_id);
create policy "owners create their alert settings" on public.alert_settings for insert to authenticated
  with check ((select auth.uid()) = owner_id);
create policy "owners change their alert settings" on public.alert_settings for update to authenticated
  using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);

-- The digest looks up new comments and reports by time.
create index comments_created_at_idx on public.comments (created_at);
create index reports_created_at_idx on public.reports (created_at);
