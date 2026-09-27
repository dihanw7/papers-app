-- Run this in the Supabase SQL Editor (after migration_12).
-- Lets admins reset a paper: delete every submission and in-progress attempt
-- for it, so students can take it again from scratch. The paper, its
-- questions and its settings are kept. Safe to re-run.

-- How many submissions / in-progress attempts a paper has (for the warning).
create or replace function public.admin_paper_activity(pid uuid)
returns jsonb as $$
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;
  return jsonb_build_object(
    'submitted', (select count(*) from public.attempts where paper_id = pid),
    'in_progress', (select count(*) from public.draft_attempts where paper_id = pid)
  );
end;
$$ language plpgsql security definer stable set search_path = public;

create or replace function public.admin_reset_paper(pid uuid)
returns jsonb as $$
declare
  n_submitted int;
  n_in_progress int;
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;
  delete from public.attempts where paper_id = pid;
  get diagnostics n_submitted = row_count;
  delete from public.draft_attempts where paper_id = pid;
  get diagnostics n_in_progress = row_count;
  return jsonb_build_object('submitted', n_submitted, 'in_progress', n_in_progress);
end;
$$ language plpgsql security definer volatile set search_path = public;

revoke execute on function public.admin_paper_activity(uuid) from public, anon;
revoke execute on function public.admin_reset_paper(uuid) from public, anon;
grant execute on function public.admin_paper_activity(uuid) to authenticated;
grant execute on function public.admin_reset_paper(uuid) to authenticated;
