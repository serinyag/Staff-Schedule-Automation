# n8n Workflow: Staff Availability Intake

This workflow receives availability submissions from the frontend webhook, upserts them into Google Sheets, optionally emails the staff member a confirmation, and returns:

```json
{ "status": "received" }
```

## Frontend webhook URL

Set the frontend environment variable to your n8n production webhook URL:

```env
NEXT_PUBLIC_WEBHOOK_URL=https://YOUR_N8N_HOST/webhook/availability
```

For local testing in n8n, the temporary test URL is usually:

```text
https://YOUR_N8N_HOST/webhook-test/availability
```

## Expected incoming payload

```json
{
  "staff_name": "Ana Torres",
  "email": "ana@studio.com",
  "submitted_at": "2026-05-01T10:23:00Z",
  "month": "2026-05",
  "unavailable_dates": ["2026-05-06", "2026-05-07", "2026-05-14"]
}
```

## Google Sheet setup

Create a Google Sheet document with a tab named `Availability`.

Recommended columns:

```text
submission_key | staff_name | email | month | unavailable_dates | submitted_at
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
  "submission_key": "={{((($json.body?.staff_name ?? $json.staff_name) + '|' + ($json.body?.month ?? $json.month))).toLowerCase().trim()}}",
  "first_name": "={{(($json.body?.staff_name ?? $json.staff_name ?? '').trim().split(' '))[0] ?? 'there'}}",
  "dates_for_email": "={{(($json.body?.unavailable_dates ?? $json.unavailable_dates ?? []).length > 0) ? (($json.body?.unavailable_dates ?? $json.unavailable_dates).join(', ')) : 'none'}}"
}
```

This node prepares:

- a comma-joined string for Google Sheets
- a deterministic upsert key
- a first name for the email
- a human-readable date list for the email

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
=Hi {{$json.first_name}}, we've got your unavailable dates: {{$json.dates_for_email}}. If anything changes, just resubmit.
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
- If you want prettier email dates like `May 6, May 7, May 14`, add a Code node before `Send Email` to format them.

## References

- Webhook node docs: https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.webhook/
- Google Sheets node docs: https://docs.n8n.io/integrations/builtin/app-nodes/n8n-nodes-base.googlesheets/
- Google Sheets sheet operations: https://docs.n8n.io/integrations/builtin/app-nodes/n8n-nodes-base.googlesheets/sheet-operations/
- Send Email node docs: https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.sendemail/
- Edit Fields node docs: https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.set/
