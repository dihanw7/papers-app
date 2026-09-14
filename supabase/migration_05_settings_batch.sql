-- Run this in the Supabase SQL Editor.

-- Settings table driving the sign-up form's Group and Batch dropdowns.
-- Readable by anyone (even signed-out visitors, since the sign-up form needs
-- it before an account exists), writable only by admins.
create table if not exists public.app_settings (
  id boolean primary key default true,
  groups text[] not null default array['A','B','C','D','E','F','G','H','I','J'],
  batches text[] not null default array['30','31','32','33','34'],
  constraint app_settings_singleton check (id)
);
insert into public.app_settings (id) values (true) on conflict (id) do nothing;

alter table public.app_settings enable row level security;
drop policy if exists settings_select_all on public.app_settings;
create policy settings_select_all on public.app_settings for select using (true);
drop policy if exists settings_admin_update on public.app_settings;
create policy settings_admin_update on public.app_settings for update using (public.is_admin()) with check (public.is_admin());

-- Track each student's batch alongside their existing group.
alter table public.profiles add column if not exists batch text;

create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, name, "group", med_no, batch)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', ''),
    coalesce(new.raw_user_meta_data->>'group', ''),
    coalesce(new.raw_user_meta_data->>'med_no', ''),
    coalesce(new.raw_user_meta_data->>'batch', '')
  );
  return new;
end;
$$ language plpgsql security definer;
