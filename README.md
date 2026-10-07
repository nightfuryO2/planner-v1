# planner-v1

A responsive, shared day/week planner inspired by familiar calendar conventions. Members can
see the team's schedules and manage their own plans; admins can manage all plans and categories.
The app uses Next.js for the website and Supabase Auth/Postgres for sign-in, shared data, and
database-enforced permissions.

## Run locally

1. Install Node.js 20.9 or later.
2. Create a Supabase project.
3. In the Supabase SQL editor, run
   [`supabase/migrations/202610060001_initial_schema.sql`](./supabase/migrations/202610060001_initial_schema.sql).
4. Copy `.env.example` to `.env.local` and set the project's **Project URL** and **anon/public**
   key. These values are available in Supabase project API settings. Do not put a service-role
   key in the browser app.
5. Enable email/password sign-in in Supabase Authentication. Set the site's local and deployed
   URLs in the Supabase Auth URL configuration.
6. Run `npm install` and `npm run dev`, then open `http://localhost:3000`.

Without the Supabase environment variables, the app displays setup instructions instead of
pretending that sign-in or data storage is available.

## Roles and team access

After the initial schema has been installed, run
[`supabase/migrations/202610070001_boa_roles_and_admin_user_management.sql`](./supabase/migrations/202610070001_boa_roles_and_admin_user_management.sql)
in the Supabase SQL editor. Existing members are migrated to the `boa` role, which is also the
default for new sign-ups. BOA users can view the team schedule and create, edit, or delete only
their own plans.

To bootstrap the first admin, have the account sign up first, then run this query in the Supabase
SQL editor, replacing the email address:

```sql
update public.profiles
set role = 'admin'
where id = (
  select id from auth.users where lower(email) = lower('admin@example.com')
);
```

Once promoted, admins can open **Team** in the planner to search registered users and promote
BOA users to admins or demote other admins to BOA. The final admin cannot be demoted. Role
management is enforced by admin-only Postgres functions; ordinary users cannot update role values
directly. Admins can manage every plan and administer category names and colors.

To let admins create a plan on behalf of a member, apply
[`supabase/migrations/202610070002_admin_create_member_plans.sql`](./supabase/migrations/202610070002_admin_create_member_plans.sql)
in the Supabase SQL editor. Admin-created plans are owned by the selected member, who can manage
that plan like their own.

To allow members to add a custom category on a plan, apply
[`supabase/migrations/202610070003_other_plan_category.sql`](./supabase/migrations/202610070003_other_plan_category.sql)
in the Supabase SQL editor. The plan form will then show an **Other** category option and request
a custom category name.

For shared plan locations and two admin-only BOA preview profiles, apply
[`supabase/migrations/202610070004_location_and_boa_test_profiles.sql`](./supabase/migrations/202610070004_location_and_boa_test_profiles.sql)
in the Supabase SQL editor. Admins can select **Test BOA 1** or **Test BOA 2** from the planner's
**Preview BOA** control. Preview mode uses BOA permissions in the interface while keeping the
admin's real authentication intact; plans created in preview are owned by the selected test
profile. These are preview profiles, not passwordless authentication accounts.

To add category definitions, apply
[`supabase/migrations/202610070005_category_definitions.sql`](./supabase/migrations/202610070005_category_definitions.sql)
in the Supabase SQL editor. Admins can then write a definition for each category in **Manage
categories**, and everyone can read them from **Category definitions** in the sidebar. Until the
migration is applied, the planner works as before and the definition fields are hidden.

To allow plans that cross midnight (for example 11:45 PM to 12:15 AM), apply
[`supabase/migrations/202610080001_overnight_plans.sql`](./supabase/migrations/202610080001_overnight_plans.sql)
in the Supabase SQL editor. An end time earlier than the start time then means the plan ends on the
following day.

## Planner behavior

- Day and Monday-to-Sunday week views, with a date picker and previous/next navigation.
- `/` is the planner home; `/team` is the signed-in team directory. BOA users can view names and roles, while admins can also manage user roles.
- Schedules use the selected day and the browser's local time.
- Refresh the schedule after another member adds or changes a plan.
- Every plan is drawn at its scheduled start time with a height matching its duration. Overlapping plans sit side by side in lanes; when more than three overlap in a week or member column (six in the combined day view), the rest collapse into a **+N** chip that opens the day by member. Use hover or keyboard focus for full details, or tap a plan to open details on touch devices.
- The day view shows one column per team member by default, with each member's plan count and planned hours in the header. Switch to **Combined** under **Display** to see all plans in a single column. Members can add plans only in their own column; admins can add plans in any real member's column.
- Each member has a stable color and initials. Under **Display**, choose whether plans are colored by **Member** or **Category**; the other is still shown on the card.
- A plan whose end time is earlier than its start time runs overnight and ends the next day (plans are shorter than 24 hours). The calendar shows it on both days, with dashed edges where it continues past midnight, and the plan form labels it **Ends next day**.
- Members can create, edit, and delete their own plans; other members' plans are read-only.
- Other members' plan notes are private; only the owner and admins can read them.
- Plan locations are visible to the whole team.
- Categories are shared across the team. Admins can add, recolor, rename, define, and deactivate them.
- The category filter is collapsed into a dropdown in the sidebar; its button shows how many categories are shown. **Category definitions** opens a guide to what each category means and stays available whether the dropdown is open or closed.
- Email confirmation behavior follows the Supabase project's Auth settings.

## Deploy to Vercel

Import this project into Vercel, configure `NEXT_PUBLIC_SUPABASE_URL` and
`NEXT_PUBLIC_SUPABASE_ANON_KEY` as environment variables, and deploy. Add the Vercel production
URL (and any preview URLs you use) to Supabase Authentication's allowed redirect/site URLs.
Database credentials and the Supabase service-role key are not required by this app.
