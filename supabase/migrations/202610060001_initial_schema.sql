create extension if not exists pgcrypto;

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null,
  role text not null default 'member' check (role in ('member', 'admin')),
  created_at timestamptz not null default now()
);

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (length(trim(name)) between 1 and 40),
  color text not null check (color ~ '^#[0-9A-Fa-f]{6}$'),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.plans (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) between 1 and 100),
  details text check (details is null or length(details) <= 500),
  category_id uuid not null references public.categories (id),
  plan_date date not null,
  start_time time not null,
  end_time time not null,
  created_by uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_time > start_time)
);

create index plans_date_start_idx on public.plans (plan_date, start_time);
create index plans_created_by_idx on public.plans (created_by);

create function public.set_plan_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger set_plans_updated_at
  before update on public.plans
  for each row execute procedure public.set_plan_updated_at();

create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), split_part(new.email, '@', 1))
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

create function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role = 'admin'
  );
$$;

create view public.team_plans
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
  created_by
from public.plans;

alter table public.profiles enable row level security;
alter table public.categories enable row level security;
alter table public.plans enable row level security;

revoke all on public.profiles, public.categories, public.plans from anon, authenticated;
revoke all on public.team_plans from anon, authenticated;

grant select on public.profiles to authenticated;
grant update (display_name) on public.profiles to authenticated;
grant select on public.categories to authenticated;
grant insert, update on public.categories to authenticated;
grant select (id) on public.plans to authenticated;
grant insert, update, delete on public.plans to authenticated;
grant select on public.team_plans to authenticated;

create policy "Authenticated users can view member profiles"
  on public.profiles for select to authenticated
  using (true);

create policy "Members can update their own display name"
  on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

create policy "Authenticated users can view categories"
  on public.categories for select to authenticated
  using (true);

create policy "Admins can add categories"
  on public.categories for insert to authenticated
  with check ((select public.is_admin()));

create policy "Admins can update categories"
  on public.categories for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

create policy "Authenticated users can view all plans"
  on public.plans for select to authenticated
  using (true);

create policy "Members can add their own plans"
  on public.plans for insert to authenticated
  with check (created_by = (select auth.uid()));

create policy "Members can update their own plans and admins can update all"
  on public.plans for update to authenticated
  using (created_by = (select auth.uid()) or (select public.is_admin()))
  with check (created_by = (select auth.uid()) or (select public.is_admin()));

create policy "Members can delete their own plans and admins can delete all"
  on public.plans for delete to authenticated
  using (created_by = (select auth.uid()) or (select public.is_admin()));

insert into public.categories (name, color) values
  ('Drive', '#4285F4'),
  ('Travel', '#9334E6'),
  ('Comp off', '#F9AB00'),
  ('WFO', '#188038'),
  ('Leave', '#D93025'),
  ('Meeting', '#039BE5'),
  ('Focus time', '#E67C73');
