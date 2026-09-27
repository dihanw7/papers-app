-- Run this in the Supabase SQL Editor (after migration_13).
-- Lets admins see who has started a paper without submitting, and reset one
-- student's attempt at one paper (submitted or unfinished) so they can take
-- it again. Everyone else's results are kept. Safe to re-run.

-- Students who have started this paper but not submitted it.
create or replace function public.admin_in_progress(pid uuid)
returns table (user_id uuid, name text, med_no text, "group" text, started_at timestamptz, updated_at timestamptz, answered int) as $$
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;
  return query
    select d.user_id, p.name, p.med_no, p."group", d.started_at, d.updated_at,
           (select count(*)::int from jsonb_object_keys(coalesce(d.answers, '{}'::jsonb)))
    from public.draft_attempts d
    join public.profiles p on p.id = d.user_id
    where d.paper_id = pid
    order by d.started_at;
end;
$$ language plpgsql security definer stable set search_path = public;

create or replace function public.admin_reset_attempt(pid uuid, uid uuid)
returns void as $$
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;
  delete from public.attempts where paper_id = pid and user_id = uid;
  delete from public.draft_attempts where paper_id = pid and user_id = uid;
end;
$$ language plpgsql security definer volatile set search_path = public;

-- Submitting now needs a start record (every current version of the app
-- creates one when the paper is opened). Otherwise a student who was reset
-- while the paper was still on their screen could submit their old answers.
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
  else
    -- No start record: never started, or an admin reset them. They need to
    -- open the paper again (which starts a fresh attempt) before submitting.
    raise exception 'Your attempt was reset or has not been started. Open the paper again to start.';
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

revoke execute on function public.admin_in_progress(uuid) from public, anon;
revoke execute on function public.admin_reset_attempt(uuid, uuid) from public, anon;
grant execute on function public.admin_in_progress(uuid) to authenticated;
grant execute on function public.admin_reset_attempt(uuid, uuid) to authenticated;
