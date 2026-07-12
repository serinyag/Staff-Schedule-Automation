# Production Architecture

## Current

`Supabase -> n8n Workflow 01 -> Workflow 02 -> Workflow 03 -> Workflow 05 -> Workflow 04 -> UI`

## Target

`Supabase planning snapshot -> n8n orchestration -> scheduling engine generate endpoint -> deterministic validation endpoint -> atomic Supabase draft save -> manager review in Next.js -> strict Supabase publish RPC`

## Transition Notes

- Workflow 03 becomes an HTTP call into the future scheduling engine.
- Workflow 04 becomes an HTTP validation and review call.
- Workflow 05 should eventually call an idempotent atomic draft-replacement RPC.
- Supabase remains the final publish-protection layer.
- Drafts may contain warnings or uncovered shifts.
- Published schedules must satisfy hard rules or have valid approved exceptions.

## Ownership Direction

- Supabase owns persistence, immutable run history, atomic draft replacement, and strict publish enforcement.
- Next.js owns manager review, editing, approval, and publishing UX.
- n8n owns orchestration, retries, status transitions, and notifications.
- The scheduling engine owns planning, deterministic validation, scoring, and manager-review candidate generation.
