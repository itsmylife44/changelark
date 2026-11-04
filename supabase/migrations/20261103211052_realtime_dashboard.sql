-- Live dashboard: stream changes to comments, reports and releases (vote counts) to signed-in developers.
-- Realtime checks each change against the subscriber's RLS policies, so developers only hear about their own apps.
alter publication supabase_realtime add table public.comments, public.reports, public.releases;
