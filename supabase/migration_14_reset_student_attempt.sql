-- Run this in the Supabase SQL Editor (after migration_13).
-- Lets admins reset one student's attempt at one paper, so they can take it
-- again. Everyone else's results are kept. Safe to re-run.
create or replace function public.admin_reset_attempt(pid uuid, uid uuid)
returns void as $$
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;
  delete from public.attempts where paper_id = pid and user_id = uid;
  delete from public.draft_attempts where paper_id = pid and user_id = uid;
end;
$$ language plpgsql security definer volatile set search_path = public;

revoke execute on function public.admin_reset_attempt(uuid, uuid) from public, anon;
grant execute on function public.admin_reset_attempt(uuid, uuid) to authenticated;
