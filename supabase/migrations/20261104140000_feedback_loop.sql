-- Three ways to close the feedback loop: a webhook per app, translated notes, and bug reports with a screenshot.

-- Webhook: new comments, reports and bug reports are posted to Slack, Discord or any URL. Only the owner sees it.
alter table public.apps add column webhook_url text
  check (webhook_url is null or (webhook_url ~ '^https?://[^\s]+$' and char_length(webhook_url) <= 500));
grant update (webhook_url) on public.apps to authenticated;

-- Translations of the notes, keyed by language code: {"it": "…", "de": "…"}. notes stays the default language.
alter table public.releases add column translations jsonb not null default '{}'::jsonb
  check (jsonb_typeof(translations) = 'object');
grant insert (translations), update (translations) on public.releases to authenticated;

-- Bug reports sent from inside the app. Private: only the app's owner reads them; nobody else sees them at all.
create table public.bug_reports (
  id uuid primary key default gen_random_uuid(),
  app_id uuid not null references public.apps on delete cascade,
  version text not null check (version ~ '^\d+(\.\d+){0,3}$'),
  body text not null check (char_length(body) between 1 and 2000),
  device text not null default '' check (char_length(device) <= 120),
  screenshot_path text,
  reporter_tag text not null,
  reporter_name text not null,
  resolved boolean not null default false,
  created_at timestamptz not null default now()
);
create index bug_reports_app_created on public.bug_reports (app_id, created_at desc);
alter table public.bug_reports enable row level security;
revoke all on public.bug_reports from anon, authenticated;
grant select, delete on public.bug_reports to authenticated;
grant update (resolved) on public.bug_reports to authenticated;
grant all on public.bug_reports to service_role;
create policy "owners read bug reports" on public.bug_reports for select to authenticated
  using ((select private.owns_app(app_id)));
create policy "owners resolve bug reports" on public.bug_reports for update to authenticated
  using ((select private.owns_app(app_id))) with check ((select private.owns_app(app_id)));
create policy "owners delete bug reports" on public.bug_reports for delete to authenticated
  using ((select private.owns_app(app_id)));
alter publication supabase_realtime add table public.bug_reports;

-- Screenshots live in a private bucket, one folder per app ("<app id>/<report id>.png").
-- The server uploads them with the secret key; owners read them through short-lived signed URLs.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('screenshots', 'screenshots', false, 2097152, array['image/png', 'image/jpeg'])
on conflict (id) do nothing;
create policy "owners read their screenshots" on storage.objects for select to authenticated
  using (bucket_id = 'screenshots' and (select private.owns_app(((storage.foldername(name))[1])::uuid)));
