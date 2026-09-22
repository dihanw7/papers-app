-- Run this in the Supabase SQL Editor.
-- Optional scheduled availability window for a paper, on top of the
-- existing per-student time_limit_minutes. Both are optional and combine:
-- a student's countdown is whichever deadline (personal time limit or the
-- paper's closes_at) comes first.
alter table public.papers add column if not exists opens_at timestamptz;
alter table public.papers add column if not exists closes_at timestamptz;
