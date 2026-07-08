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

Optional:

- `N8N_AVAILABILITY_WEBHOOK_URL`
- `N8N_SCHEDULE_GENERATION_WEBHOOK_URL`

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
- Availability saves through the authenticated `public.submit_staff_availability` RPC and Supabase remains the system of record.
- Schedule generation orchestration uses the server-only `N8N_SCHEDULE_GENERATION_WEBHOOK_URL` and sends only `generation_run_id` plus `period_id` after the run is created.
- Every shift starts available by default.
- Clicking a day toggles all three shifts together.
- Morning/day/evening can also be adjusted individually inside each day tile.
