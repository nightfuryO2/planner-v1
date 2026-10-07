alter table public.profiles
  drop constraint if exists profiles_role_check;

update public.profiles
set role = 'boa'
where role = 'member';

alter table public.profiles
  alter column role set default 'boa',
  add constraint profiles_role_check check (role in ('boa', 'admin'));

revoke update (role) on public.profiles from authenticated;

create or replace function public.admin_list_users()
returns table (
  user_id uuid,
  email text,
  display_name text,
  role text,
  joined_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (select public.is_admin()) then
    raise exception 'Only admins can view the team user directory.'
      using errcode = '42501';
  end if;

  return query
  select
    u.id::uuid,
    coalesce(u.email, '')::text,
    p.display_name::text,
    p.role::text,
    p.created_at::timestamptz
  from auth.users as u
  join public.profiles as p on p.id = u.id
  order by p.created_at, p.display_name;
end;
$$;

create or replace function public.admin_set_user_role(target_user_id uuid, new_role text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_role text;
  admin_count bigint;
begin
  if (select auth.uid()) is null or not (select public.is_admin()) then
    raise exception 'Only admins can change team user roles.'
      using errcode = '42501';
  end if;

  if new_role is null or new_role not in ('boa', 'admin') then
    raise exception 'Role must be boa or admin.'
      using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(9812301, 1);

  select p.role into current_role
  from public.profiles as p
  where p.id = target_user_id
  for update;

  if not found then
    raise exception 'The selected team member does not exist.'
      using errcode = 'P0002';
  end if;

  select count(*) into admin_count
  from public.profiles
  where role = 'admin';

  if current_role = 'admin' and new_role = 'boa' and admin_count <= 1 then
    raise exception 'The last admin cannot be demoted.'
      using errcode = '23514';
  end if;

  update public.profiles
  set role = new_role
  where id = target_user_id;
end;
$$;

revoke all on function public.admin_list_users() from public, anon;
revoke all on function public.admin_set_user_role(uuid, text) from public, anon;
grant execute on function public.admin_list_users() to authenticated;
grant execute on function public.admin_set_user_role(uuid, text) to authenticated;
