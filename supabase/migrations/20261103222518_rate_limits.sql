-- Fixed-window rate limits for anonymous writes, keyed by a hash of the caller's IP. Server only.

create table public.rate_limits (
  bucket text not null,
  window_start timestamptz not null,
  hits integer not null default 0,
  primary key (bucket, window_start)
);
alter table public.rate_limits enable row level security; -- no policies: only the server reaches it
revoke all on public.rate_limits from anon, authenticated;
grant all on public.rate_limits to service_role;

-- Counts one hit and says whether the caller is still within the limit. One statement, so concurrent requests can't race.
create function public.rate_limit_hit(p_bucket text, p_limit integer, p_window_seconds integer) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  v_start timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  v_hits integer;
begin
  insert into public.rate_limits (bucket, window_start, hits) values (p_bucket, v_start, 1)
  on conflict (bucket, window_start) do update set hits = public.rate_limits.hits + 1
  returning hits into v_hits;
  -- ponytail: cleans old windows on ~1% of calls; move to pg_cron if the table ever grows large.
  if random() < 0.01 then
    delete from public.rate_limits where window_start < now() - interval '1 day';
  end if;
  return v_hits <= p_limit;
end;
$$;

revoke execute on function public.rate_limit_hit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.rate_limit_hit(text, integer, integer) to service_role;
