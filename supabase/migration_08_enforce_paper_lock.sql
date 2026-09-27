-- Run this in the Supabase SQL Editor.
-- Enforces paper locks/schedules in the database, not just in the app's screens.
-- Before this, any signed-in student could read every paper's questions (and
-- correct answers) straight from the API, even while the paper was locked.
--
-- After this, a student can read a paper's questions only when:
--   - the paper is open right now (schedule window, or manual unlock), or
--   - they have already submitted it (so they can review it), or
--   - they started it while it was open (a saved draft), so they can finish
--     or be auto-submitted when the window closes.
-- Admins can always read everything.

-- Same rule as paperStatus() in src/main.js.
create or replace function public.paper_is_open_now(pid uuid)
returns boolean as $$
  select coalesce((
    select case
      when p.opens_at is not null or p.closes_at is not null then
        (p.opens_at is null or now() >= p.opens_at)
        and (p.closes_at is null or now() < p.closes_at)
      else p.is_open
    end
    from public.papers p where p.id = pid
  ), false);
$$ language sql security definer stable set search_path = public;

create or replace function public.can_view_questions(pid uuid)
returns boolean as $$
  select public.is_admin()
    or public.paper_is_open_now(pid)
    or exists(select 1 from public.attempts a where a.paper_id = pid and a.user_id = auth.uid())
    or exists(select 1 from public.draft_attempts d where d.paper_id = pid and d.user_id = auth.uid());
$$ language sql security definer stable set search_path = public;

drop policy if exists questions_select_all on public.questions;
create policy questions_select_all on public.questions for select
  using (auth.role() = 'authenticated' and public.can_view_questions(paper_id));

-- Drafts can only be started while the paper is open, so a student can't create
-- a draft on a locked paper just to unlock its questions. Updating an existing
-- draft is unchanged.
drop policy if exists draft_insert_own on public.draft_attempts;
create policy draft_insert_own on public.draft_attempts for insert
  with check (auth.uid() = user_id and public.paper_is_open_now(paper_id));

-- Same for submissions: allowed while open, or if the student already had a
-- draft (they were mid-paper when it locked/closed, or it's the auto-submit).
drop policy if exists attempts_insert_own on public.attempts;
create policy attempts_insert_own on public.attempts for insert
  with check (
    auth.uid() = user_id
    and (
      public.paper_is_open_now(paper_id)
      or exists(select 1 from public.draft_attempts d where d.paper_id = attempts.paper_id and d.user_id = auth.uid())
    )
  );

-- Question counts for the paper list, visible even while a paper is locked.
-- Returns counts only, never question content. MTF groups count as one question.
create or replace function public.paper_question_counts(paper_ids uuid[])
returns table (paper_id uuid, question_count int) as $$
  select q.paper_id, count(distinct coalesce(q.group_id::text, q.id::text))::int
  from public.questions q
  where q.paper_id = any(paper_ids)
  group by q.paper_id;
$$ language sql security definer stable set search_path = public;

grant execute on function public.paper_question_counts(uuid[]) to authenticated;
