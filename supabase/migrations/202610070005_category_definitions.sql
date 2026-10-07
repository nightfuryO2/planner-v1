alter table public.categories
  add column if not exists description text
  check (description is null or length(trim(description)) between 1 and 300);
