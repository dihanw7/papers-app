-- Run this in the Supabase SQL Editor (after migration_10).
-- Admin tools for the Members tab. Every function checks the caller is an admin.
-- Safe to re-run.

-- Everyone who has signed up, with their last sign-in and how many papers
-- they've submitted.
create or replace function public.admin_list_members()
returns table (
  id uuid, name text, "group" text, batch text, med_no text, role text,
  created_at timestamptz, last_sign_in_at timestamptz, attempt_count int
) as $$
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;
  return query
    select p.id, p.name, p."group", p.batch, p.med_no, p.role, p.created_at, u.last_sign_in_at,
           (select count(*)::int from public.attempts a where a.user_id = p.id)
    from public.profiles p
    left join auth.users u on u.id = p.id
    order by p.created_at desc;
end;
$$ language plpgsql security definer stable set search_path = public, auth;

-- Edit a member's details and role. You can't remove your own admin role,
-- so there's always at least one admin.
create or replace function public.admin_update_member(uid uuid, p_name text, p_group text, p_batch text, p_role text)
returns void as $$
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;
  if p_role not in ('student', 'admin') then raise exception 'Role must be student or admin.'; end if;
  if uid = auth.uid() and p_role <> 'admin' then raise exception 'You can''t remove your own admin role.'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'Name can''t be empty.'; end if;
  update public.profiles
     set name = trim(p_name), "group" = coalesce(p_group, ''), batch = coalesce(p_batch, ''), role = p_role
   where id = uid;
  if not found then raise exception 'Member not found.'; end if;
end;
$$ language plpgsql security definer volatile set search_path = public;

-- Set a new password for a member (they sign in with their MED number, so
-- there's no email reset).
create or replace function public.admin_set_password(uid uuid, new_password text)
returns void as $$
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;
  if length(coalesce(new_password, '')) < 6 then raise exception 'Password must be at least 6 characters.'; end if;
  update auth.users set encrypted_password = crypt(new_password, gen_salt('bf')), updated_at = now() where id = uid;
  if not found then raise exception 'Member not found.'; end if;
end;
$$ language plpgsql security definer volatile set search_path = public, extensions, auth;

-- Permanently delete an account, with their submissions and drafts.
-- Papers they created (if they were an admin) are kept.
create or replace function public.admin_delete_member(uid uuid)
returns void as $$
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;
  if uid = auth.uid() then raise exception 'You can''t delete your own account here.'; end if;
  update public.papers set created_by = null where created_by = uid;
  delete from public.draft_attempts where user_id = uid;
  delete from public.attempts where user_id = uid;
  delete from public.profiles where id = uid;
  delete from auth.users where id = uid;
end;
$$ language plpgsql security definer volatile set search_path = public, auth;

revoke execute on function public.admin_list_members() from public, anon;
revoke execute on function public.admin_update_member(uuid, text, text, text, text) from public, anon;
revoke execute on function public.admin_set_password(uuid, text) from public, anon;
revoke execute on function public.admin_delete_member(uuid) from public, anon;
grant execute on function public.admin_list_members() to authenticated;
grant execute on function public.admin_update_member(uuid, text, text, text, text) to authenticated;
grant execute on function public.admin_set_password(uuid, text) to authenticated;
grant execute on function public.admin_delete_member(uuid) to authenticated;
