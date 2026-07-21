# Scheduling Engine Service

This directory contains the production scheduling-engine service used by the WNC
stack.

As of engine version `0.3.1`, the service now includes:

- a deterministic validator for rule catalogue version `2`;
- a deterministic CP-SAT schedule generator at `POST /v1/schedules/generate`;
- shared pure rule helpers used by both generator and validator;
- no direct database access, no n8n orchestration logic, and no agent or LLM
  calls inside the engine.

HTTP surface:

- `GET /health`
- `GET /version`
- `POST /v1/schedules/generate`
- `POST /v1/schedules/validate`

Core expectations:

- The service must be stateless.
- The engine must not write directly to Supabase.
- It receives a planning snapshot and returns structured JSON responses.
- Supabase remains the source of truth, persistence layer, and final publish gate.
- n8n remains the orchestrator outside the engine boundary.

No person-specific business rules may be hard-coded here. Staff-specific differences must continue to come from data fields such as contracts, availability, training phase, roles, preferences, and approved exceptions.

## Directory layout

```text
services/scheduling-engine/
├── app/
│   ├── __init__.py
│   ├── main.py
│   ├── auth.py
│   ├── settings.py
│   ├── shared/
│   │   ├── __init__.py
│   │   └── scheduling.py
│   ├── generator/
│   │   ├── __init__.py
│   │   ├── context.py
│   │   ├── diagnostics.py
│   │   ├── eligibility.py
│   │   ├── model.py
│   │   ├── objectives.py
│   │   └── service.py
│   ├── models/
│   │   ├── __init__.py
│   │   ├── generation_request.py
│   │   ├── generation_result.py
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
- `POST /v1/schedules/generate` builds a deterministic OR-Tools CP-SAT model,
  solves it lexicographically, validates the generated draft internally, and
  returns a structured draft response.
- `POST /v1/schedules/validate` validates a supplied draft plan deterministically
  against the same shared rules and cost logic.

## Endpoint behavior

### `GET /health`

Response:

```json
{
  "status": "ok",
  "service": "wnc-scheduling-engine",
  "engine_version": "0.3.1",
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
  "engine_version": "0.3.1",
  "rules_version": "2"
}
```

### `POST /v1/schedules/generate`

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
    "period": {
      "id": "26617a4e-9b43-47a8-905b-46b76b4bfd20",
      "start_date": "2026-07-06",
      "end_date": "2026-07-12",
      "monthly_staff_budget_eur": 12000
    },
    "staff": [],
    "shifts": [],
    "training": [],
    "contracts": [],
    "availability_days": [],
    "availability_submissions": [],
    "training_rules": {
      "phase_1_assignment_type": "shadow",
      "phase_1_counts_as_primary_coverage": false,
      "phase_1_requires_same_shift_phase_3": true,
      "qualified_trainer_phase": "phase_3_fully_trained",
      "qualified_trainer_work_roles": ["*"],
      "same_mentor_required": false,
      "mentor_history_required": false,
      "designated_initial_mentor_required": false,
      "initial_mentor_shift_count": 0
    },
    "budget_policy": {
      "configured_budget_eur": 12000,
      "allow_overage_for_mandatory_coverage": true,
      "allow_overage_for_weekly_minimums": true,
      "allow_overage_for_required_training": true,
      "allow_overage_for_weekly_targets": false,
      "allow_overage_for_soft_quality": false,
      "minimize_required_overage": true,
      "overage_requires_manager_review": true
    }
  },
  "engine_configuration": {
    "max_solve_seconds": 30,
    "random_seed": 42,
    "include_shadow_assignments": true,
    "diagnostics_level": "summary"
  }
}
```

Example response:

```json
{
  "generation_run_id": "56a5944b-286d-4a9c-bc2c-6f89739ed2b1",
  "period_id": "26617a4e-9b43-47a8-905b-46b76b4bfd20",
  "generation_status": "optimal",
  "engine_version": "0.3.1",
  "rules_version": "2",
  "draft_plan": {
    "assignments": [
      {
        "shift_id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        "staff_member_id": "11111111-1111-1111-1111-111111111111",
        "staff_name": "Synthetic Staff",
        "assignment_kind": "coverage",
        "assignment_lifecycle": "draft",
        "assignment_source": "railway_generator_v1",
        "is_exception": false,
        "planning_reason": "mandatory_coverage",
        "shift_date": "2026-07-06",
        "shift_type": "morning",
        "start_time": null,
        "end_time": null,
        "week_start": "2026-07-06"
      }
    ],
    "uncovered_shifts": [],
    "manager_review_suggestions": [],
    "weekly_summary": [],
    "planner_diagnostics": {
      "planner_version": "wnc-generator-v1-cp-sat",
      "solver_status": "OPTIMAL"
    }
  },
  "draft_assignments": [
    {
      "shift_id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      "staff_member_id": "11111111-1111-1111-1111-111111111111",
      "staff_name": "Synthetic Staff",
      "assignment_kind": "coverage",
      "assignment_lifecycle": "draft",
      "assignment_source": "railway_generator_v1",
      "is_exception": false,
      "planning_reason": "mandatory_coverage",
      "shift_date": "2026-07-06",
      "shift_type": "morning",
      "start_time": null,
      "end_time": null,
      "week_start": "2026-07-06"
    }
  ],
  "validation": {
    "valid": true,
    "ready_for_commit": true,
    "engine_version": "0.3.1",
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
  },
  "solver": {
    "status": "OPTIMAL",
    "wall_time_seconds": 0.02,
    "objective_values": {
      "mandatory_coverage_shortfall": 0,
      "weekly_minimum_shortfall": 0,
      "weekly_target_shortfall": 0,
      "above_target_usage": 0,
      "schedule_quality": 0
    },
    "random_seed": 42,
    "num_search_workers": 1
  }
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
        "is_initial_training_mentor": false,
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
    "role_rules": [
      {
        "id": "cccccccc-cccc-cccc-cccc-cccccccccccc",
        "name": "Host",
        "scheduling_rule_role": "host",
        "work_role": "host",
        "is_active": true,
        "rule_config": {}
      }
    ],
    "training_rules": {
      "phase_1_assignment_type": "shadow",
      "phase_1_counts_as_primary_coverage": false,
      "phase_1_requires_same_shift_phase_3": true,
      "qualified_trainer_phase": "phase_3_fully_trained",
      "qualified_trainer_work_roles": ["*"],
      "same_mentor_required": false,
      "mentor_history_required": false,
      "designated_initial_mentor_required": false,
      "initial_mentor_shift_count": 0
    },
    "budget_policy": {
      "configured_budget_eur": 12000,
      "allow_overage_for_mandatory_coverage": true,
      "allow_overage_for_weekly_minimums": true,
      "allow_overage_for_required_training": true,
      "allow_overage_for_weekly_targets": false,
      "allow_overage_for_soft_quality": false,
      "minimize_required_overage": true,
      "overage_requires_manager_review": true
    },
    "diagnostics": {},
    "preferences": [],
    "generated_at": "2026-07-13T09:00:00Z",
    "context_version": 2,
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
  "engine_version": "0.3.1",
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
- `WNC-HARD-003` Weekly minimum with consolidated boundary-week warnings
- `WNC-HARD-004` Weekly maximum
- `WNC-HARD-005` Above-target consent
- `WNC-HARD-006` Availability required
- `WNC-HARD-007` Mandatory service coverage
- `WNC-HARD-009` Same-day duplicate
- `WNC-HARD-010` Evening-to-next-morning
- `WNC-HARD-011` Unknown training phases
- `WNC-HARD-012` Phase 1 shadow-only pairing with any same-shift Phase 3 trainer
- `WNC-HARD-013` Phase 2 closing
- `WNC-HARD-014` Hard maximum consecutive days
- `WNC-HARD-016` Draft lifecycle warning
- `WNC-HARD-018` Budget
- `WNC-SOFT-001` Below weekly target
- `WNC-SOFT-002` Unbalanced target/max use
- `WNC-SOFT-004` Fragmented patterns
- `WNC-SOFT-005` Soft consecutive maximum
- `WNC-SOFT-006` Full weekend
- `WNC-SOFT-007` Consecutive weekend burden

## Generator architecture

- API transport lives in `app/api/schedules.py`.
- Typed request and response models live in `app/models/`.
- Shared pure rule helpers live in `app/shared/scheduling.py`.
- Indexed planning-context normalization lives in `app/generator/context.py`.
- Static staff/shift eligibility lives in `app/generator/eligibility.py`.
- CP-SAT variable and hard-constraint construction lives in `app/generator/model.py`.
- Sequential lexicographic objective solving lives in `app/generator/objectives.py`.
- Result extraction, diagnostics, weekly summaries, and internal validator
  invocation live in `app/generator/service.py`.

## Generator behavior

- The generator uses local Google OR-Tools CP-SAT only.
- Currency is converted to integer cents before entering the solver.
- Coverage and weekly minimums are optimized before lower-priority quality
  preferences.
- Phase 1 trainees are generated as paid `shadow` assignments only.
- Any Phase 3 fully trained staff member can qualify as the same-shift trainer.
- Shadow assignments count toward workload, budget, minimums, targets, and
  maximums, but not toward mandatory service coverage.
- Optional day shifts may be selected when they help satisfy weekly minimums or
  training needs.
- The configured period budget is a manager threshold, not an unconditional hard
  cap when coverage, valid training, or weekly minimum obligations would fail.
- Both generator and validator use the same shared cost, availability,
  assignment-kind, and week-boundary helpers.

## Objective hierarchy

The generator uses sequential solves with one shared wall-clock deadline:

1. Minimize uncovered mandatory coverage.
2. Fix Stage 1 and minimize complete-week minimum shortfall.
3. Fix Stage 2 and minimize required budget overage.
4. Fix Stage 3 and minimize weekly target shortfall without increasing overage.
5. Fix Stage 4 and minimize above-target usage plus soft schedule quality:
   isolated-day reduction, full-weekend reduction, and manager-usage reduction.

## Assignment kinds

- `coverage`: canonical operational coverage assignment.
- `shadow`: canonical Phase 1 paid shadow/training assignment.

Aliases such as `primary` and `training` are still normalized for validator
compatibility, but generator output emits canonical values.

## Generation statuses

- `optimal`
- `feasible`
- `needs_manager_review`
- `infeasible`
- `timeout`
- `model_invalid`

When hard needs cannot all be satisfied, the generator returns the best
available draft plus explicit shortfall diagnostics instead of fabricating an
invalid schedule.

## Quality-signal notes in version 0.3.1

- Grouped work blocks are neutral quality data and do not produce validator
  warnings.
- Fragmented work patterns still produce `WNC-SOFT-004` warnings when the
  worked-date pattern contains isolated days or repeated one-day gaps.
- Soft consecutive limits still produce `WNC-SOFT-005` warnings when a streak
  exceeds `settings.default_soft_max_consecutive_days`.
- Hard consecutive limits still produce `WNC-HARD-014` errors when a streak
  exceeds `settings.default_hard_max_consecutive_days`.
- Partial-week boundary warnings are consolidated to one
  `insufficient_boundary_context` warning per incomplete ISO week.
- Complete Monday-through-Sunday weeks still enforce weekly minimums as hard
  errors.
- Over-budget but otherwise hard-compliant drafts remain valid, but not ready
  for commit, until management raises the period budget and regenerates.

## Intentionally deferred details

- No Supabase reads or writes occur inside the engine.
- No n8n workflow changes are included here.
- No agent or LLM is used in generator v1.
- No designated mentor, same-mentor continuity, or mentor-history rule is
  enforced by generator or validator decisions.
- `WNC-EXC-005` remains enforced indirectly by rejecting unknown staff
  assignments rather than creating external wildcard assignments.
