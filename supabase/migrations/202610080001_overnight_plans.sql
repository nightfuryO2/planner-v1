-- Allow plans that cross midnight: an end time earlier than the start time means the plan
-- ends on the following day. Start and end may not be equal.
do $$
declare
  constraint_name text;
begin
  for constraint_name in
    select con.conname
    from pg_constraint as con
    where con.conrelid = 'public.plans'::regclass
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%end_time > start_time%'
  loop
    execute format('alter table public.plans drop constraint %I', constraint_name);
  end loop;
end
$$;

alter table public.plans
  drop constraint if exists plans_time_range_check;

alter table public.plans
  add constraint plans_time_range_check check (end_time <> start_time);
