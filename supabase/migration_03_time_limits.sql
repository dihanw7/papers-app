-- Run this in the Supabase SQL Editor.
alter table public.papers add column if not exists time_limit_minutes int;
