-- Run this in the Supabase SQL Editor (after migration_09).
-- The Lock switch now works on scheduled papers too: a locked paper is closed
-- even inside its open/close window. (Before, scheduled papers ignored it.)
-- Safe to re-run.

-- Scheduled papers never used the switch, and most were saved with it off
-- (migration_07's default), so unlock them all once so they keep following
-- their schedule. Only runs the first time (guarded by the marker below).
do $$
begin
  if not exists (select 1 from pg_proc where proname = 'paper_lock_overrides_schedule') then
    update public.papers set is_open = true where opens_at is not null or closes_at is not null;
  end if;
end $$;
create or replace function public.paper_lock_overrides_schedule() returns boolean as $$ select true $$ language sql immutable;

create or replace function public.paper_is_open_now(pid uuid)
returns boolean as $$
  select coalesce((
    select p.is_open
      and (p.opens_at is null or now() >= p.opens_at)
      and (p.closes_at is null or now() < p.closes_at)
    from public.papers p where p.id = pid
  ), false);
$$ language sql security definer stable set search_path = public;

create or replace function public.answer_window_open(pid uuid, started timestamptz)
returns boolean as $$
  select coalesce((
    select p.is_open
      and (p.opens_at is null or now() >= p.opens_at)
      and (p.closes_at is null or now() < p.closes_at + interval '2 minutes')
      and (p.time_limit_minutes is null or started is null
           or now() < started + make_interval(mins => p.time_limit_minutes) + interval '2 minutes')
    from public.papers p where p.id = pid
  ), false);
$$ language sql security definer stable set search_path = public;
