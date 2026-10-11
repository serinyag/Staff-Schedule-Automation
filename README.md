# Staff Availability

Single-page staff availability submission UI built with Next.js App Router and Tailwind CSS.

## Local development

```bash
npm install
npm run dev
```

## Environment configuration

Required:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` for manager-only staff onboarding, Auth linking, and invitation delivery

Optional:

- `SCHEDULE_APP_ORIGIN` for local Vercel development; production uses its configured Vercel domain.

For local testing, copy `.env.example` to `.env.local`.

## Submission payload

```json
{
  "period_id": "schedule-period-uuid",
  "period_name": "August 2026",
  "submission_status": "submitted",
  "staff_name": "canonical name string",
  "email": "staff@example.com",
  "month": "YYYY-MM",
  "willing_to_work_above_target": false,
  "max_extra_shifts_for_period": null,
  "unavailable_dates": ["YYYY-MM-DD", "YYYY-MM-DD"],
  "unavailable_shifts": [
    {
      "date": "YYYY-MM-DD",
      "shifts": ["morning", "evening"],
      "labels": ["Morning", "Evening"]
    }
  ],
  "shift_availability": [
    {
      "date": "YYYY-MM-DD",
      "morning": "available",
      "day": "unavailable",
      "evening": "available"
    }
  ]
}
```

## Notes

- Staff names are normalised on blur using exact lowercase-trim matching first, then Levenshtein distance with a `<= 2` threshold.
- Availability saves through the authenticated `public.save_monthly_availability` RPC and Supabase remains the system of record.
- Schedule generation runs through the website’s authenticated Python Vercel function at `/api/scheduling_engine`. It loads planning data from Supabase, runs the existing solver, and saves a draft atomically. n8n is no longer required. Use `vercel dev` when testing the Python endpoint locally.
- Manager staff onboarding uses secure server-side Supabase Admin APIs and never exposes the service-role key to the browser.
- Every shift starts available by default.
- Clicking a day toggles all three shifts together.
- Morning/day/evening can also be adjusted individually inside each day tile.

## Monthly workflow

Apply migrations 026 and 027 before deploying the updated application.

- On the first availability/schedule page request after a month boundary (Europe/Amsterdam), the next calendar month is opened idempotently, including required morning and evening shifts. No cron or n8n job is needed. Existing unfinished months remain open; past dates are read-only.
- Draft saves create private revisions without replacing submitted availability. Save changes updates the effective submission. Optimistic revision checks prevent stale tabs from overwriting newer work.
- Published-month edits become pending requests. Managers review them on Team Availability. Approval cannot invalidate an existing published assignment; conflicting requests require cover first or rejection with an explanatory note.
- Availability changes invalidate the draft’s validation. Managers must revalidate before publication. A database trigger enforces this even outside the UI.
- Generation requires all active staff to submit, preserves training assignment kinds, and refuses to save results if availability changed during the run. Interrupted runs can be retried after five minutes.
- Availability revisions and manager decisions are retained in Supabase. No invitations or reminder emails are sent by this workflow.

Verification: `npm run lint`, `npm test`, `npm run build`, Python scheduler tests, and `supabase/tests/monthly_availability_workflow.sql` (rolls back its test data).
