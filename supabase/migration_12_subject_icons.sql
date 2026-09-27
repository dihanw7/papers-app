-- Run this in the Supabase SQL Editor (after migration_11).
-- Optional custom icon per subject, uploaded by an admin as an SVG file.
-- Subjects without one use a built-in icon matched by name (Paediatrics,
-- Surgery, Medicine, Gyn & Obs, Psychiatry), or a letter tile.
-- Existing policies already let everyone read subjects and only admins edit them.
-- Safe to re-run.
alter table public.subjects add column if not exists icon_svg text;
