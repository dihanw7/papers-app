-- Run this in the Supabase SQL Editor.
-- Draft attempts let students' in-progress answers autosave as they go,
-- separate from the final `attempts` table (which stays immutable once
-- submitted — no update policy on it, by design, so scores can't be tampered
-- with). Drafts are freely readable/writable by their own owner only.

create table if not exists public.draft_attempts (
  id uuid primary key default gen_random_uuid(),
  paper_id uuid references public.papers(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete cascade,
  answers jsonb not null default '{}',
  updated_at timestamptz default now(),
  unique (paper_id, user_id)
);

alter table public.draft_attempts enable row level security;

drop policy if exists draft_select_own on public.draft_attempts;
create policy draft_select_own on public.draft_attempts for select using (auth.uid() = user_id);
drop policy if exists draft_insert_own on public.draft_attempts;
create policy draft_insert_own on public.draft_attempts for insert with check (auth.uid() = user_id);
drop policy if exists draft_update_own on public.draft_attempts;
create policy draft_update_own on public.draft_attempts for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists draft_delete_own on public.draft_attempts;
create policy draft_delete_own on public.draft_attempts for delete using (auth.uid() = user_id);
