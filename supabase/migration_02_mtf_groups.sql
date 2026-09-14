-- Run this in the Supabase SQL Editor. Adds support for grouped MTF
-- (multiple true/false) questions: several statements sharing one stem,
-- scored together with contained negative marking.
-- Safe to run on top of the original schema.sql.

alter table public.questions add column if not exists group_id uuid;
alter table public.questions add column if not exists group_stem text;
alter table public.questions add column if not exists group_order int;

-- (No RLS changes needed — existing policies on public.questions already cover these columns.)
