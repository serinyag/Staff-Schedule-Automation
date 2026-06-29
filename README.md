# Staff Availability

Single-page staff availability submission UI built with Next.js App Router and Tailwind CSS.

## Local development

```bash
npm install
npm run dev
```

## Webhook configuration

Set `NEXT_PUBLIC_WEBHOOK_URL` in Vercel project settings.

For local testing, copy `.env.example` to `.env.local` and set the webhook URL there.

## Submission payload

```json
{
  "staff_name": "canonical name string",
  "email": "staff@example.com",
  "submitted_at": "ISO 8601 timestamp",
  "month": "YYYY-MM",
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
- The default calendar view opens on the next calendar month.
- Every shift starts available by default.
- Clicking a day toggles all three shifts together.
- Morning/day/evening can also be adjusted individually inside each day tile.
