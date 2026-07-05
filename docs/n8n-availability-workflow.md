# n8n Workflow: Staff Availability Intake

This workflow is an optional downstream step. The app saves availability to Supabase first via `public.submit_staff_availability`, then can best-effort notify n8n so it can upsert into Google Sheets, optionally email the staff member a confirmation, and return:

```json
{ "status": "received" }
```

## App webhook URL

Set the server-side environment variable to your n8n production webhook URL:

```env
N8N_AVAILABILITY_WEBHOOK_URL=https://YOUR_N8N_HOST/webhook/availability
```

For local testing in n8n, the temporary test URL is usually:

```text
https://YOUR_N8N_HOST/webhook-test/availability
```

## Expected incoming payload

```json
{
  "period_id": "schedule-period-uuid",
  "period_name": "August 2026",
  "submission_id": "availability-submission-uuid",
  "submission_status": "submitted",
  "staff_name": "Ana Torres",
  "email": "ana@studio.com",
  "submitted_at": "2026-05-01T10:23:00Z",
  "month": "2026-05",
  "willing_to_work_above_target": false,
  "max_extra_shifts_for_period": null,
  "unavailable_dates": ["2026-05-14"],
  "unavailable_shifts": [
    {
      "date": "2026-05-06",
      "shifts": ["morning", "day"],
      "labels": ["Morning", "Day"]
    },
    {
      "date": "2026-05-14",
      "shifts": ["morning", "day", "evening"],
      "labels": ["Morning", "Day", "Evening"]
    }
  ],
  "shift_availability": [
    {
      "date": "2026-05-06",
      "morning": "unavailable",
      "day": "unavailable",
      "evening": "available"
    }
  ]
}
```

## Google Sheet setup

Create a Google Sheet document with a tab named `Availability`.

Recommended columns:

```text
submission_key | staff_name | email | month | unavailable_dates | unavailable_shifts | shift_availability | submitted_at
```

`submission_key` is a helper column used for reliable upserts by `staff_name + month`.
You can hide this column in Google Sheets if you don't want to see it.

If you must keep only the visible columns you listed, you can do a more complex
`Get Row(s) -> Update Row / Append Row` flow instead, but `submission_key` is the
cleanest and most reliable approach.

## Workflow structure

```text
Webhook
  -> Edit Fields (Normalize Submission)
  -> Google Sheets (Append or Update Row)
  -> IF (email exists?)
       true  -> Send Email -> Edit Fields (Response Body)
       false -> Edit Fields (Response Body)
```

## Node-by-node configuration

### 1. Webhook

- Node: `Webhook`
- HTTP Method: `POST`
- Path: `availability`
- Respond: `When Last Node Finishes`
- Response Code: `200`
- Response Data: `First Entry JSON`

This matches the official n8n webhook behavior for returning the last node's JSON output.

### 2. Edit Fields (Normalize Submission)

- Node: `Edit Fields` (formerly Set)
- Mode: `JSON Output`
- Keep Only Set Fields: `On`

Use this JSON:

```json
{
  "staff_name": "={{$json.body?.staff_name ?? $json.staff_name}}",
  "email": "={{$json.body?.email ?? $json.email ?? ''}}",
  "month": "={{$json.body?.month ?? $json.month}}",
  "submitted_at": "={{$json.body?.submitted_at ?? $json.submitted_at}}",
  "unavailable_dates_array": "={{$json.body?.unavailable_dates ?? $json.unavailable_dates ?? []}}",
  "unavailable_dates": "={{(($json.body?.unavailable_dates ?? $json.unavailable_dates ?? [])).join(', ')}}",
  "unavailable_shifts": "={{JSON.stringify($json.body?.unavailable_shifts ?? $json.unavailable_shifts ?? [])}}",
  "shift_availability": "={{JSON.stringify($json.body?.shift_availability ?? $json.shift_availability ?? [])}}",
  "submission_key": "={{((($json.body?.staff_name ?? $json.staff_name) + '|' + ($json.body?.month ?? $json.month))).toLowerCase().trim()}}",
  "first_name": "={{(($json.body?.staff_name ?? $json.staff_name ?? '').trim().split(' '))[0] ?? 'there'}}",
  "dates_for_email": "={{(($json.body?.unavailable_shifts ?? $json.unavailable_shifts ?? []).length > 0) ? (($json.body?.unavailable_shifts ?? $json.unavailable_shifts).map((entry) => `${entry.date}: ${entry.labels.join('/')}`).join('; ')) : 'none'}}"
}
```

This node prepares:

- a comma-joined full-day unavailable date string for Google Sheets
- JSON strings for detailed shift-level data
- a deterministic upsert key
- a first name for the email
- a human-readable shift list for the email

### 3. Google Sheets

- Node: `Google Sheets`
- Resource: `Sheet Within Document`
- Operation: `Append or Update Row`
- Document: your spreadsheet
- Sheet: `Availability`
- Mapping Column Mode: `Map Automatically`
- Column to Match On: `submission_key`

Incoming fields written by the previous node:

- `submission_key`
- `staff_name`
- `email`
- `month`
- `unavailable_dates`
- `unavailable_shifts`
- `shift_availability`
- `submitted_at`

Because `submission_key` is stable for the same person and month, resubmissions overwrite instead of duplicating.

This matches the documented Google Sheets `Append or Update Row` behavior in n8n.

### 4. IF

- Node: `IF`
- Condition type: `String`
- Value 1: `={{$json.email}}`
- Operation: `is not empty`

If the submitter provided an email, send the confirmation.
If not, skip straight to the response node.

### 5. Send Email

- Node: `Send Email`
- Credential: your SMTP credential
- From Email: your sending address, for example:

```text
Studio Admin <schedule@yourdomain.com>
```

- To Email:

```text
={{$json.email}}
```

- Subject:

```text
=Availability received for {{$json.month}}
```

- Email Format: `Text`
- Text:

```text
=Hi {{$json.first_name}}, we've got your unavailable shifts: {{$json.dates_for_email}}. If anything changes, just resubmit.
```

### 6. Edit Fields (Response Body)

- Node: `Edit Fields`
- Mode: `JSON Output`
- Keep Only Set Fields: `On`

Use this JSON:

```json
{
  "status": "received"
}
```

Because the Webhook node is set to `When Last Node Finishes`, this becomes the HTTP response body.

## Notes

- n8n handles JSON POST bodies and standard webhook CORS behavior for this use case.
- The scheduling workflow can read directly from the `Availability` sheet later.
- `unavailable_dates` now means only dates where all three shifts are unavailable.
- `unavailable_shifts` and `shift_availability` contain the detailed morning/day/evening handoff data.
- If you want prettier email dates like `May 6: Morning/Day`, add a Code node before `Send Email` to format them.

## References

- Webhook node docs: https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.webhook/
- Google Sheets node docs: https://docs.n8n.io/integrations/builtin/app-nodes/n8n-nodes-base.googlesheets/
- Google Sheets sheet operations: https://docs.n8n.io/integrations/builtin/app-nodes/n8n-nodes-base.googlesheets/sheet-operations/
- Send Email node docs: https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.sendemail/
- Edit Fields node docs: https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.set/
