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
  "unavailable_dates": ["YYYY-MM-DD", "YYYY-MM-DD"]
}
```

## Notes

- Staff names are normalised on blur using exact lowercase-trim matching first, then Levenshtein distance with a `<= 2` threshold.
- The default calendar view opens on the next calendar month.
- Availability is binary: all days start available and toggle to unavailable when selected.
