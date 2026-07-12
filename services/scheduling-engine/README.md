# Scheduling Engine Service

This directory is the future independently deployed scheduling service.

Planned HTTP surface:

- `POST /v1/schedules/generate`
- `POST /v1/schedules/validate`
- `POST /v1/schedules/review` (optional)

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
