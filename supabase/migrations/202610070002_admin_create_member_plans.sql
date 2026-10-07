drop policy if exists "Members can add their own plans" on public.plans;

create policy "Members can add their own plans and admins can add plans for anyone"
  on public.plans for insert to authenticated
  with check (
    created_by = (select auth.uid())
    or (select public.is_admin())
  );
