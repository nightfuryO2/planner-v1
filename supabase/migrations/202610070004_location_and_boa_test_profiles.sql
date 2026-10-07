alter table public.profiles
  add column if not exists is_test boolean not null default false;

alter table public.profiles
  drop constraint if exists profiles_id_fkey;

alter table public.profiles
  drop constraint if exists profiles_role_check;

update public.profiles
set role = 'boa'
where role = 'member';

alter table public.profiles
  alter column role set default 'boa',
  add constraint profiles_role_check check (role in ('boa', 'admin'));

insert into public.profiles (id, display_name, role, is_test)
values
  ('00000000-0000-4000-8000-000000000001', 'Test BOA 1', 'boa', true),
  ('00000000-0000-4000-8000-000000000002', 'Test BOA 2', 'boa', true)
on conflict (id) do update
set display_name = excluded.display_name,
    role = 'boa',
    is_test = true;

alter table public.plans
  add column if not exists location text
  check (location is null or length(trim(location)) between 1 and 120);

create or replace function public.handle_deleted_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.profiles where id = old.id;
  return old;
end;
$$;

drop trigger if exists on_auth_user_deleted on auth.users;
create trigger on_auth_user_deleted
  before delete on auth.users
  for each row execute procedure public.handle_deleted_auth_user();

drop policy if exists "Members can add their own plans" on public.plans;
drop policy if exists "Members can add their own plans and admins can add plans for anyone" on public.plans;

create policy "Members can add their own plans and admins can add plans for anyone"
  on public.plans for insert to authenticated
  with check (
    created_by = (select auth.uid())
    or (select public.is_admin())
  );

create or replace view public.team_plans
with (security_barrier = true)
as
select
  id,
  title,
  case
    when created_by = (select auth.uid()) or (select public.is_admin()) then details
    else null
  end as details,
  category_id,
  plan_date,
  start_time,
  end_time,
  created_by,
  custom_category,
  location
from public.plans;
