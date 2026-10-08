-- Category types drive the team summary's comp off counts:
--   working  - work done on a Sunday or holiday earns a comp off
--   comp_off - a comp off taken
--   holiday  - a public holiday the member marked
--   other    - not counted
alter table public.categories
  add column if not exists kind text not null default 'other'
  check (kind in ('working', 'comp_off', 'holiday', 'other'));

update public.categories
set kind = 'working'
where kind = 'other'
  and lower(trim(name)) in ('assessment', 'assessments', 'tr1 interviews', 'tr1 interview', 'work', 'wfo', 'meeting');

update public.categories
set kind = 'comp_off'
where kind = 'other'
  and lower(trim(name)) in ('comp off', 'comp offs', 'comp-off', 'compoff');

update public.categories
set kind = 'holiday'
where kind = 'other'
  and lower(trim(name)) in ('holiday', 'holidays', 'public holiday');
