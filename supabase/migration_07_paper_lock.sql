-- Run this in the Supabase SQL Editor.
-- Manual open/lock switch for papers that don't have a scheduled window.
-- Papers WITH opens_at/closes_at follow their schedule; this flag is ignored for them.
-- Existing papers stay open (so nothing already live suddenly locks);
-- papers created from now on start locked until an admin unlocks them.
alter table public.papers add column if not exists is_open boolean not null default true;
alter table public.papers alter column is_open set default false;
