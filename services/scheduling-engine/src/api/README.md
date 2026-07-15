# API Layer

This layer will expose the engine's HTTP endpoints and request/response handling.

Responsibilities:

- Accept validated planning snapshots and draft plans
- Return structured JSON only
- Stay stateless
- Avoid direct Supabase writes in the first version
- Translate transport concerns into domain/service calls
