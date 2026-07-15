# Deployment Roadmap

## Phase 1

- Preserve current n8n prototype
- Add repository structure
- Add versioned rule catalogue
- Add shared API schemas
- Add immutable planning snapshots in a future migration
- Add atomic generation-run claiming in a future migration

## Phase 2

- Build scheduling engine beside n8n
- Use saved August 2026 planning context as a regression fixture
- Add deterministic eligibility and validation
- Add automated rule tests

## Phase 3

- Shadow mode
- Run existing Workflow 03 and new service
- Compare schedules without replacing production output

## Phase 4

- Replace Workflow 03 with `POST /v1/schedules/generate`
- Keep old Workflow 03 disabled for rollback

## Phase 5

- Replace Workflow 04 logic with `POST /v1/schedules/validate`
- Keep Supabase strict publish validation
