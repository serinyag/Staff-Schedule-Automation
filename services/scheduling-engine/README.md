# Scheduling Engine Service

This directory is the future independently deployed scheduling service.

This repository area now includes a minimal production-oriented API shell so the
orchestration boundary can be built and verified before the real scheduling
logic exists.

Purpose of this API shell:

- Expose a stable scheduling-engine HTTP surface.
- Enforce engine API-key authentication for private endpoints.
- Validate incoming planning payloads with strict UUID parsing.
- Return an explicit placeholder response for draft generation until the planner
  is implemented.
- Validate draft schedules deterministically against rule catalogue version 2.
- Stay stateless and avoid any direct Supabase, OpenAI, or external-network
  integration.

HTTP surface:

- `GET /health`
- `GET /version`
- `POST /v1/schedules/generate`
- `POST /v1/schedules/validate`

Core expectations:

- The service must be stateless.
- The first version must not write directly to Supabase.
- It receives a planning snapshot and returns structured JSON responses.
- Supabase remains the source of truth, persistence layer, and final publish gate.

Likely implementation stack later:

- Python
- FastAPI
- Pydantic
- OR-Tools
- pytest
- Docker

Agentic planners may be used, but deterministic eligibility, validation, and scoring must surround them.

No person-specific business rules may be hard-coded here. Staff-specific differences must continue to come from data fields such as contracts, availability, training phase, roles, preferences, and approved exceptions.

## Directory layout

```text
services/scheduling-engine/
├── app/
│   ├── __init__.py
│   ├── main.py
│   ├── auth.py
│   ├── settings.py
│   ├── models/
│   │   ├── __init__.py
│   │   ├── planning_context.py
│   │   ├── draft_plan.py
│   │   └── validation_result.py
│   └── api/
│       ├── __init__.py
│       ├── health.py
│       └── schedules.py
├── tests/
├── requirements.txt
├── requirements-dev.txt
├── Dockerfile
├── .dockerignore
└── .env.example
```

The existing `src/` documentation remains as architecture guidance for the
later implementation phases.

## Environment variables

Copy `.env.example` and provide a real private value for:

- `ENGINE_API_KEY`

Optional local configuration:

- `APP_ENV` default `development`
- `PORT` default `8000`

In `APP_ENV=production`, startup fails if `ENGINE_API_KEY` is missing.

## Local setup

```bash
cd services/scheduling-engine
python3 -m venv .venv
source .venv/bin/activate
pip install --no-cache-dir -r requirements-dev.txt
cp .env.example .env
```

Then set a local development key in `.env`, for example:

```bash
ENGINE_API_KEY=replace-with-a-local-secret
```

## Local run command

```bash
cd services/scheduling-engine
export ENGINE_API_KEY=replace-with-a-local-secret
uvicorn app.main:create_app --factory --reload --host 0.0.0.0 --port 8000
```

OpenAPI docs will be available at:

- `http://localhost:8000/docs`
- `http://localhost:8000/openapi.json`

## Local test instructions

```bash
cd services/scheduling-engine
pytest
```

## Docker build and run commands

Build:

```bash
cd services/scheduling-engine
docker build -t wnc-scheduling-engine .
```

Run:

```bash
docker run --rm \
  -e ENGINE_API_KEY=replace-with-a-real-secret \
  -e APP_ENV=production \
  -p 8000:8000 \
  wnc-scheduling-engine
```

## Current behavior

- `GET /health` is public and returns service metadata.
- `GET /version` requires `X-Engine-API-Key`.
- `POST /v1/schedules/generate` validates the request and returns HTTP `501`.
- `POST /v1/schedules/validate` validates the request and returns HTTP `200`
  with deterministic validation results, even when rule violations are found.

The schedule generator itself is intentionally not implemented yet.

## Endpoint behavior

### `GET /health`

Response:

```json
{
  "status": "ok",
  "service": "wnc-scheduling-engine",
  "engine_version": "0.2.0",
  "rules_version": "2"
}
```

### `GET /version`

Headers:

```text
X-Engine-API-Key: <secret>
```

Response:

```json
{
  "service": "wnc-scheduling-engine",
  "engine_version": "0.2.0",
  "rules_version": "2"
}
```

### `POST /v1/schedules/generate`

The generator remains a placeholder.

Response:

```json
{
  "error": "not_implemented",
  "message": "The scheduling engine has not been implemented yet.",
  "engine_version": "0.2.0",
  "rules_version": "2"
}
```

### `POST /v1/schedules/validate`

Headers:

```text
X-Engine-API-Key: <secret>
Content-Type: application/json
```

Example request:

```json
{
  "generation_run_id": "56a5944b-286d-4a9c-bc2c-6f89739ed2b1",
  "period_id": "26617a4e-9b43-47a8-905b-46b76b4bfd20",
  "rules_version": "2",
  "planning_context": {
    "staff": [
      {
        "id": "11111111-1111-1111-1111-111111111111",
        "full_name": "Synthetic Staff",
        "is_active": true,
        "work_role": "studio_staff",
        "scheduling_rule_role": "staff",
        "hourly_rate": 20,
        "is_wildcard_fill_in": false,
        "is_initial_training_mentor": true,
        "default_weekly_budget_shifts": null
      }
    ],
    "period": {
      "id": "26617a4e-9b43-47a8-905b-46b76b4bfd20",
      "start_date": "2026-07-06",
      "end_date": "2026-07-12",
      "monthly_staff_budget_eur": 12000
    },
    "shifts": [
      {
        "id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        "period_id": "26617a4e-9b43-47a8-905b-46b76b4bfd20",
        "shift_date": "2026-07-06",
        "shift_type": "morning",
        "start_time": null,
        "end_time": null,
        "is_optional": false,
        "required_count": 1
      }
    ],
    "budgets": [],
    "settings": {
      "block_evening_to_next_morning": true,
      "default_hard_max_consecutive_days": 5,
      "default_soft_max_consecutive_days": 3
    },
    "training": [
      {
        "staff_id": "11111111-1111-1111-1111-111111111111",
        "phase": "phase_3_fully_trained"
      }
    ],
    "contracts": [
      {
        "id": "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
        "staff_id": "11111111-1111-1111-1111-111111111111",
        "start_date": "2026-07-06",
        "end_date": "2026-07-12",
        "min_shifts_per_week": 0,
        "target_shifts_per_week": 1,
        "max_shifts_per_week": 5,
        "standard_shift_hours": 8
      }
    ],
    "period_id": "26617a4e-9b43-47a8-905b-46b76b4bfd20",
    "role_rules": [],
    "diagnostics": {},
    "preferences": [],
    "generated_at": "2026-07-13T09:00:00Z",
    "context_version": 1,
    "availability_days": [
      {
        "staff_id": "11111111-1111-1111-1111-111111111111",
        "available_date": "2026-07-06",
        "morning": true,
        "day": true,
        "evening": true,
        "submission_id": null
      }
    ],
    "holiday_exemptions": [],
    "availability_submissions": [
      {
        "staff_id": "11111111-1111-1111-1111-111111111111",
        "period_id": "26617a4e-9b43-47a8-905b-46b76b4bfd20",
        "status": "submitted",
        "willing_to_work_above_target": false,
        "max_extra_shifts_for_period": null
      }
    ],
    "approved_exceptions": []
  },
  "draft_plan": {
    "assignments": [
      {
        "shift_id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        "staff_member_id": "11111111-1111-1111-1111-111111111111",
        "assignment_kind": "primary",
        "assignment_lifecycle": "draft"
      }
    ]
  }
}
```

Example response:

```json
{
  "valid": true,
  "ready_for_commit": true,
  "engine_version": "0.2.0",
  "rules_version": "2",
  "errors": [],
  "warnings": [],
  "review_items": [],
  "metrics": {
    "assignment_count": 1,
    "mandatory_shift_count": 1,
    "covered_mandatory_shift_count": 1,
    "uncovered_mandatory_shift_count": 0,
    "estimated_labor_cost_eur": 160,
    "monthly_budget_eur": 12000,
    "complete_weeks_evaluated": ["2026-07-06"],
    "partial_weeks_not_fully_evaluated": []
  }
}
```

## Implemented deterministic rule IDs in version 1

- `WNC-HARD-001` Active staff only
- `WNC-HARD-002` Active contract required
- `WNC-HARD-003` Weekly minimum with boundary-week warnings
- `WNC-HARD-004` Weekly maximum
- `WNC-HARD-005` Above-target consent
- `WNC-HARD-006` Availability required
- `WNC-HARD-007` Mandatory service coverage
- `WNC-HARD-009` Same-day duplicate
- `WNC-HARD-010` Evening-to-next-morning
- `WNC-HARD-011` Phase 1 independent coverage and unknown training phases
- `WNC-HARD-012` Phase 1 pairing, with mentor-history review items when history is unavailable
- `WNC-HARD-013` Phase 2 closing
- `WNC-HARD-014` Hard maximum consecutive days
- `WNC-HARD-016` Draft lifecycle warning
- `WNC-HARD-018` Budget
- `WNC-SOFT-001` Below weekly target
- `WNC-SOFT-002` Unbalanced target/max use
- `WNC-SOFT-003` Grouped workdays
- `WNC-SOFT-004` Fragmented patterns
- `WNC-SOFT-005` Soft consecutive maximum
- `WNC-SOFT-006` Full weekend
- `WNC-SOFT-007` Consecutive weekend burden

## Intentionally deferred details

- No schedule generation or optimization solver is implemented.
- No Supabase reads or writes occur inside the engine.
- No n8n workflow changes are included here.
- No historical mentor-shift dataset is inferred when it is absent; the validator
  emits review items instead.
- `WNC-EXC-005` remains enforced indirectly by rejecting unknown staff
  assignments rather than creating external wildcard assignments.
