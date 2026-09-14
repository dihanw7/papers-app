-- Run this once in the Supabase SQL Editor (Project > SQL Editor > New query).
-- Safe to re-run: drops nothing, uses "if not exists" / "or replace" throughout.

create extension if not exists "pgcrypto";

-- ---------- TABLES ----------

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  "group" text not null,
  med_no text unique not null,
  role text not null default 'student' check (role in ('student','admin')),
  created_at timestamptz default now()
);

create table if not exists public.subjects (
  id uuid primary key default gen_random_uuid(),
  name text unique not null,
  created_at timestamptz default now()
);

create table if not exists public.papers (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid references public.subjects(id) on delete cascade,
  name text not null,
  pass_mark int not null default 50,
  created_by uuid references public.profiles(id),
  created_at timestamptz default now()
);

create table if not exists public.questions (
  id uuid primary key default gen_random_uuid(),
  paper_id uuid references public.papers(id) on delete cascade,
  type text not null check (type in ('TF','SBA')),
  stem text not null,
  options jsonb not null,   -- [{"key":"A","text":"..."}, ...]
  correct text not null,    -- e.g. "A"
  position int not null default 0
);

create table if not exists public.attempts (
  id uuid primary key default gen_random_uuid(),
  paper_id uuid references public.papers(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete cascade,
  answers jsonb not null default '{}',  -- {"<question_id>":"A", ...}
  score int not null default 0,
  total int not null default 0,
  submitted_at timestamptz default now(),
  unique (paper_id, user_id)
);

-- ---------- AUTO-CREATE PROFILE ON SIGN-UP ----------
-- Reads name/group/med_no out of the metadata the app sends with auth.signUp().

create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, name, "group", med_no)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', ''),
    coalesce(new.raw_user_meta_data->>'group', ''),
    coalesce(new.raw_user_meta_data->>'med_no', '')
  );
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ---------- ADMIN CHECK HELPER ----------

create or replace function public.is_admin()
returns boolean as $$
  select exists(select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$ language sql security definer stable;

-- ---------- ROW LEVEL SECURITY ----------

alter table public.profiles enable row level security;
alter table public.subjects enable row level security;
alter table public.papers   enable row level security;
alter table public.questions enable row level security;
alter table public.attempts  enable row level security;

-- Profiles: any signed-in user can read (needed for names on the leaderboard);
-- nobody can edit their own row from the client — role is only changed by you,
-- the project owner, from the Table Editor (which uses the service key and
-- bypasses RLS). This is what keeps "admin" trustworthy.
drop policy if exists profiles_select_all on public.profiles;
create policy profiles_select_all on public.profiles for select using (auth.role() = 'authenticated');

-- Subjects / papers / questions: everyone signed in can read; only admins write.
drop policy if exists subjects_select_all on public.subjects;
create policy subjects_select_all on public.subjects for select using (auth.role() = 'authenticated');
drop policy if exists subjects_admin_write on public.subjects;
create policy subjects_admin_write on public.subjects for insert with check (public.is_admin());
drop policy if exists subjects_admin_update on public.subjects;
create policy subjects_admin_update on public.subjects for update using (public.is_admin());
drop policy if exists subjects_admin_delete on public.subjects;
create policy subjects_admin_delete on public.subjects for delete using (public.is_admin());

drop policy if exists papers_select_all on public.papers;
create policy papers_select_all on public.papers for select using (auth.role() = 'authenticated');
drop policy if exists papers_admin_write on public.papers;
create policy papers_admin_write on public.papers for insert with check (public.is_admin());
drop policy if exists papers_admin_update on public.papers;
create policy papers_admin_update on public.papers for update using (public.is_admin());
drop policy if exists papers_admin_delete on public.papers;
create policy papers_admin_delete on public.papers for delete using (public.is_admin());

drop policy if exists questions_select_all on public.questions;
create policy questions_select_all on public.questions for select using (auth.role() = 'authenticated');
drop policy if exists questions_admin_write on public.questions;
create policy questions_admin_write on public.questions for insert with check (public.is_admin());
drop policy if exists questions_admin_update on public.questions;
create policy questions_admin_update on public.questions for update using (public.is_admin());
drop policy if exists questions_admin_delete on public.questions;
create policy questions_admin_delete on public.questions for delete using (public.is_admin());

-- Attempts: everyone signed in can read (needed for the leaderboard and the
-- answer-percentage breakdown). Students can only insert their own attempt,
-- and there is deliberately NO update or delete policy — once submitted, an
-- attempt cannot be changed by anyone through the app, only by you directly
-- in the database.
drop policy if exists attempts_select_all on public.attempts;
create policy attempts_select_all on public.attempts for select using (auth.role() = 'authenticated');
drop policy if exists attempts_insert_own on public.attempts;
create policy attempts_insert_own on public.attempts for insert with check (auth.uid() = user_id);

-- ---------- HOW TO PROMOTE SOMEONE TO ADMIN ----------
-- After they've signed up once, run (as yourself, in the SQL Editor):
--   update public.profiles set role = 'admin' where med_no = 'MED1234';
