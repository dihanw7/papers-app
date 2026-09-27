-- Run this in the Supabase SQL Editor (after migration_08).
-- Makes exams tamper-proof from the student's side:
--   1. Marking happens here, in the database. Students' browsers never receive
--      the answer key while a paper is running, and can't submit a made-up score.
--   2. Each student's start time is recorded here, so the per-student time limit
--      and the paper's close time are enforced by the server clock. Answers sent
--      after the deadline (plus a 2-minute grace for slow connections) are
--      ignored; the student's last answers saved before the deadline count.
--   3. Papers can hide answers/results until they close (new papers do by
--      default). Until then students see "Submitted", not their review.
--   4. Other students' submissions stay hidden until results are released.
-- Safe to re-run.

-- ---------- NEW COLUMNS ----------

-- Existing papers keep showing results right after submission (as before);
-- papers created from now on hide them until the paper closes.
alter table public.papers add column if not exists results_after_close boolean not null default false;
alter table public.papers alter column results_after_close set default true;

-- When the student first opened the paper. Drives their personal time limit.
alter table public.draft_attempts add column if not exists started_at timestamptz not null default now();

-- ---------- RULES ----------

-- Can this student still answer? Paper open (with 2 minutes' grace past the
-- scheduled close) and within their personal time limit (same grace).
create or replace function public.answer_window_open(pid uuid, started timestamptz)
returns boolean as $$
  select coalesce((
    select
      (case
        when p.opens_at is not null or p.closes_at is not null then
          (p.opens_at is null or now() >= p.opens_at)
          and (p.closes_at is null or now() < p.closes_at + interval '2 minutes')
        else p.is_open
      end)
      and (p.time_limit_minutes is null or started is null
           or now() < started + make_interval(mins => p.time_limit_minutes) + interval '2 minutes')
    from public.papers p where p.id = pid
  ), false);
$$ language sql security definer stable set search_path = public;

-- May students see answers and other students' results for this paper yet?
create or replace function public.results_visible(pid uuid)
returns boolean as $$
  select coalesce((
    select not p.results_after_close or not public.paper_is_open_now(pid)
    from public.papers p where p.id = pid
  ), false);
$$ language sql security definer stable set search_path = public;

-- Who may see a paper's questions (without answers unless results are out).
-- Adds to migration_08: anyone may view a scheduled paper after it has closed.
create or replace function public.can_view_questions(pid uuid)
returns boolean as $$
  select public.is_admin()
    or public.paper_is_open_now(pid)
    or exists(select 1 from public.attempts a where a.paper_id = pid and a.user_id = auth.uid())
    or exists(select 1 from public.draft_attempts d where d.paper_id = pid and d.user_id = auth.uid())
    or exists(select 1 from public.papers p where p.id = pid and p.closes_at is not null and now() >= p.closes_at);
$$ language sql security definer stable set search_path = public;

-- ---------- TABLE ACCESS ----------

-- Questions (with the answer key) are read directly by admins only.
-- Students go through get_paper_questions() below.
drop policy if exists questions_select_all on public.questions;
create policy questions_select_all on public.questions for select using (public.is_admin());

-- Submissions: your own always; everyone's once results are visible.
-- Inserts only through submit_attempt(), so no insert policy.
drop policy if exists attempts_select_all on public.attempts;
create policy attempts_select_all on public.attempts for select using (
  auth.uid() = user_id or public.is_admin()
  or (auth.role() = 'authenticated' and public.results_visible(paper_id))
);
drop policy if exists attempts_insert_own on public.attempts;

-- Drafts: students read their own; writes only through the functions below.
drop policy if exists draft_insert_own on public.draft_attempts;
drop policy if exists draft_update_own on public.draft_attempts;
drop policy if exists draft_delete_own on public.draft_attempts;

-- ---------- FUNCTIONS THE APP CALLS ----------

-- Questions for one paper, as JSON. The answer key ("correct") is included only
-- for admins, or for students who have submitted once results are visible.
create or replace function public.get_paper_questions(pid uuid)
returns jsonb as $$
declare
  reveal boolean;
begin
  if auth.uid() is null or not public.can_view_questions(pid) then
    return '[]'::jsonb;
  end if;
  reveal := public.is_admin() or (
    public.results_visible(pid)
    and (exists(select 1 from public.attempts a where a.paper_id = pid and a.user_id = auth.uid())
         or exists(select 1 from public.papers p where p.id = pid and p.closes_at is not null and now() >= p.closes_at))
  );
  return coalesce((
    select jsonb_agg(case when reveal then to_jsonb(q) else to_jsonb(q) - 'correct' end order by q.position)
    from public.questions q where q.paper_id = pid
  ), '[]'::jsonb);
end;
$$ language plpgsql security definer stable set search_path = public;

-- Called when a student opens an open paper. Records their start time once
-- (re-opening keeps the original time) and returns it with the server's clock.
create or replace function public.start_attempt(pid uuid)
returns jsonb as $$
declare
  d public.draft_attempts;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  select * into d from public.draft_attempts where paper_id = pid and user_id = auth.uid();
  if not found then
    if not public.paper_is_open_now(pid) then raise exception 'This paper is not open.'; end if;
    insert into public.draft_attempts (paper_id, user_id, answers, started_at, updated_at)
    values (pid, auth.uid(), '{}'::jsonb, now(), now())
    on conflict (paper_id, user_id) do nothing;
    select * into d from public.draft_attempts where paper_id = pid and user_id = auth.uid();
  end if;
  return jsonb_build_object('started_at', d.started_at, 'server_now', now(), 'answers', d.answers);
end;
$$ language plpgsql security definer volatile set search_path = public;

-- Autosave. Refused once the student's time is up or the paper has closed.
create or replace function public.save_draft(pid uuid, p_answers jsonb)
returns void as $$
declare
  d public.draft_attempts;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  select * into d from public.draft_attempts where paper_id = pid and user_id = auth.uid();
  if not found then raise exception 'Open the paper before answering.'; end if;
  if not public.answer_window_open(pid, d.started_at) then raise exception 'Time is up for this paper.'; end if;
  update public.draft_attempts set answers = coalesce(p_answers, '{}'::jsonb), updated_at = now() where id = d.id;
end;
$$ language plpgsql security definer volatile set search_path = public;

-- Marks the answers and records the attempt. Same marking as the app:
-- SBA 5, standalone TF 1, MTF group = correct minus wrong, between 0 and 5.
-- If the student's time is up, their last answers saved in time are marked instead.
create or replace function public.submit_attempt(pid uuid, p_answers jsonb)
returns jsonb as $$
declare
  existing public.attempts;
  d public.draft_attempts;
  has_draft boolean;
  final_answers jsonb;
  s int;
  t int;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;

  select * into existing from public.attempts where paper_id = pid and user_id = auth.uid();
  if found then return to_jsonb(existing); end if;

  select * into d from public.draft_attempts where paper_id = pid and user_id = auth.uid();
  has_draft := found;

  if has_draft and public.answer_window_open(pid, d.started_at) then
    final_answers := coalesce(p_answers, '{}'::jsonb);
  elsif has_draft then
    final_answers := coalesce(d.answers, '{}'::jsonb);
  elsif public.paper_is_open_now(pid) then
    final_answers := coalesce(p_answers, '{}'::jsonb);
  else
    raise exception 'This paper is not open.';
  end if;

  with qs as (
    select q.type, q.correct, q.group_id is not null as grouped,
           coalesce(q.group_id::text, q.id::text) as screen,
           nullif(final_answers ->> q.id::text, '') as ans
    from public.questions q where q.paper_id = pid
  ), screens as (
    select
      case when bool_or(grouped) then 5 when max(type) = 'SBA' then 5 else 1 end as max_marks,
      case
        when bool_or(grouped) then greatest(0, least(5,
          count(*) filter (where ans is not null and ans = correct)
          - count(*) filter (where ans is not null and ans <> correct)))
        when max(ans) = max(correct) then (case when max(type) = 'SBA' then 5 else 1 end)
        else 0
      end as earned
    from qs group by screen
  )
  select coalesce(sum(earned), 0)::int, coalesce(sum(max_marks), 0)::int into s, t from screens;

  insert into public.attempts (paper_id, user_id, answers, score, total, submitted_at)
  values (pid, auth.uid(), final_answers, s, t, now())
  on conflict (paper_id, user_id) do nothing
  returning * into existing;
  if existing.id is null then
    select * into existing from public.attempts where paper_id = pid and user_id = auth.uid();
  end if;

  delete from public.draft_attempts where paper_id = pid and user_id = auth.uid();
  return to_jsonb(existing);
end;
$$ language plpgsql security definer volatile set search_path = public;

grant execute on function public.get_paper_questions(uuid) to authenticated;
grant execute on function public.start_attempt(uuid) to authenticated;
grant execute on function public.save_draft(uuid, jsonb) to authenticated;
grant execute on function public.submit_attempt(uuid, jsonb) to authenticated;
