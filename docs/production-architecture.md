# Production architecture

The application is a single-venue staff scheduling system. Next.js owns authenticated staff and manager screens. Supabase owns accounts, PostgreSQL storage and row-level access policies. A Python function runs the OR-Tools optimizer and its deterministic validator. Vercel Queues dispatches website-owned background jobs. The active path has no n8n dependency.

## Generation and persistence

1. A manager server action verifies their Supabase identity and role and calls `queue_schedule_job`.
2. PostgreSQL locks the period, checks readiness and rate limits, and saves the complete planning snapshot and existing-draft fingerprint. The browser cannot supply contracts, rules or assignments for generation.
3. The server publishes only the run ID to Vercel Queues, with the run ID as an idempotency key. No user access or refresh token is stored in the queue.
4. A private queue consumer signs a short-lived, run-bound request to the Python worker. The existing server-only service credential stays within this application's trusted backend.
5. `claim_schedule_job` verifies the initiating manager is still active and grants a four-minute lease. An unexpired lease prevents duplicate work; a new token fences out an older worker. There are at most three claimed attempts and a one-hour delivery window.
6. The optimizer has a 60-second solve budget. The database client enforces a 125-second overall execution deadline and 15-second individual network timeouts. The consumer has a 150-second HTTP deadline; both Vercel functions allow 180 seconds. A function crash can be redelivered after its lease expires.
7. The deterministic validator checks generated and adopted alternatives. Monthly flexibility changes workload policy explicitly while retaining hard weekly maximums, availability, rest and training rules.
8. `finish_schedule_job` checks that inputs, draft and engine version still match. Optional shift proposals, assignment replacement, result metadata, final status and audit event commit in one transaction. A failed transaction preserves the previous draft.
9. The manager screen refreshes while a job is active. A manager can leave and return. Transient failures retry; stale inputs and invalid results stop with a clear failure state.

The write gate serializes only short snapshot/save/edit/publication transactions. It is not held during optimization. Planning-input writes acquire the same gate. PostgreSQL deadlocks/serialization failures are safe transaction failures and are retryable for workers. Manual edits can continue during optimization; the result is rejected instead of overwriting an intervening edit.

## Editing and publication

Assignment and optional day-shift edits use authorized database functions. Source and destination must belong to the selected, editable period. Moves are a single update in the same transaction as the audit event. Direct authenticated writes to shifts, assignments and generation runs are revoked.

Checking or publishing loads the saved draft and current planning snapshot through the caller's session. The same Python validator used by generation checks that snapshot. Only the trusted backend can record a validation attestation. PostgreSQL binds it to the exact input fingerprint, assignment fingerprint, schedule mode and engine version. An intervening change invalidates it. Publishing requires an up-to-date attestation with no blocking errors or outstanding review requirements; assignment publication and period status commit together. Published periods cannot be reopened through a direct table update.

The legacy SQL validator remains only as a diagnostic fallback for drafts not yet checked. It cannot authorize publication. Empty optional day shifts are excluded from fallback coverage flags.

## Security and diagnostics

- User-facing actions verify identity and active role on the server; RPCs repeat authorization in PostgreSQL.
- Trusted worker RPCs are granted only to `service_role`. Validation and audit history are read-only for authorized managers.
- Custom mutation routes require same-origin JSON and enforce streamed request-size and UUID/date validation.
- Worker requests use HMAC signatures bound to the exact body and expire after 90 seconds. Replays cannot bypass leases or mutate completed runs.
- Structured diagnostics include run ID, stage, attempt, duration and classified errors. They exclude tokens, planning snapshots, staff names and raw database errors.
- Framework request failures receive a safe error reference and a retry screen. Availability edits retain their existing revision checks.
- Security headers deny framing, object embedding and unnecessary browser permissions. The CSP is intentionally partial; it does not claim strict script isolation.

## Release checks

CI must pass lint, TypeScript checks, app tests, Python engine/runtime tests, PostgreSQL transaction/privilege tests, production dependency audits and a production build. Python production dependencies are pinned with hashes; npm uses its lockfile. Dependabot checks dependencies and actions weekly.

The isolated PostgreSQL fixture tests transaction and permission behavior. It deliberately does not claim to reproduce the entire existing Supabase schema. The same rollback regression suite must also pass on the linked schema before applying the migration. Never apply a database reset to the production project.
