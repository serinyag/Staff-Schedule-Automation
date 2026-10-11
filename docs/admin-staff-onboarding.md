# Admin Staff Onboarding

Manager-facing staff onboarding is handled from `/admin/staff` and coordinates:

- Supabase Auth invitation or existing Auth-user linking
- `public.profiles`
- `public.staff_members`
- `public.employment_contracts`
- `public.staff_training_status`
- `public.staff_portal_accounts`
- `public.staff_admin_audit_log`

## Required server environment

- `SUPABASE_SERVICE_ROLE_KEY`

This key is required only on the server. Do not expose it to the browser and do not store it in `NEXT_PUBLIC_*` variables.

## Supabase Auth redirect URL

Add the production callback URL to Supabase Auth redirect settings:

- `https://your-app-domain.example/auth/callback`

For local development also add:

- `http://localhost:3000/auth/callback`

## Deployment checklist

1. Merge the onboarding branch into `main`.
2. Apply the new migration with Supabase CLI:
   - `npx supabase db push`
3. Confirm Vercel has:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
4. Redeploy Vercel.
5. Open `/admin/staff`.
6. Add a new employee or repair an existing manual Auth user through the drawer.
7. Confirm the invited or linked employee can sign in and reach `/availability` only when the linked profile is active.

## Manual verification SQL

```sql
select *
from public.staff_portal_accounts
order by updated_at desc;

select *
from public.staff_admin_audit_log
order by created_at desc
limit 20;

select
  staff.id,
  staff.full_name,
  staff.profile_id,
  staff.is_active,
  contract.start_date,
  contract.end_date,
  training.phase,
  training.opening_training_completed_on,
  training.fully_trained_on
from public.staff_members staff
left join public.employment_contracts contract
  on contract.staff_id = staff.id
left join public.staff_training_status training
  on training.staff_id = staff.id
order by staff.full_name;
```

## Password recovery and accepted invitations

`/login` links to `/forgot-password`. Supabase sends a recovery email with a callback to `/auth/callback?next=%2Fauth%2Fcomplete%3Fmode%3Drecovery`; allow this exact URL for the production origin in Auth URL Configuration. The callback exchanges the PKCE code and preserves session cookies before displaying the password form. Existing invitation/implicit recovery links remain supported. PKCE recovery links must be opened in the same browser that requested them. Missing, expired or unverifiable links offer a new reset request. Responses do not reveal whether an email has an account.

The stored portal invitation status records delivery, not acceptance. Manager badges and filters derive current state from the linked Supabase Auth account: confirmation or a sign-in after the invitation overrides a historical pending status. A different account ID or a sign-in before the invitation cannot clear the pending badge. Disabled profiles, missing contracts and training still retain their setup warnings. Regression tests cover these distinctions.
