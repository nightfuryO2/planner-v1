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

## Planner behavior

- Day and Monday-to-Sunday week views, with a date picker and previous/next navigation.
- Schedules use the selected day and the browser's local time.
- Refresh the schedule after another member adds or changes a plan.
- Members can create, edit, and delete their own plans; other members' plans are read-only.
- Other members' plan notes are private; only the owner and admins can read them.
- Categories are shared across the team. Admins can add, recolor, rename, and deactivate them.
- Email confirmation behavior follows the Supabase project's Auth settings.

## Deploy to Vercel

Import this project into Vercel, configure `NEXT_PUBLIC_SUPABASE_URL` and
`NEXT_PUBLIC_SUPABASE_ANON_KEY` as environment variables, and deploy. Add the Vercel production
URL (and any preview URLs you use) to Supabase Authentication's allowed redirect/site URLs.
Database credentials and the Supabase service-role key are not required by this app.
