alter table public.plans
  add column custom_category text
  check (
    custom_category is null
    or length(trim(custom_category)) between 1 and 40
  );

insert into public.categories (name, color, active)
values ('Other', '#607D8B', true)
on conflict (name) do update
set active = true;

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
  custom_category
from public.plans;
