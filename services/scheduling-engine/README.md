# Scheduling Engine Service

This directory is the future independently deployed scheduling service.

This repository area now includes a minimal production-oriented API shell so the
orchestration boundary can be built and verified before the real scheduling
logic exists.

Purpose of this API shell:

- Expose a stable scheduling-engine HTTP surface.
- Enforce engine API-key authentication for private endpoints.
- Validate incoming planning payloads with strict UUID parsing.
- Return explicit placeholder responses until the planner and validator are
  implemented.
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
- `POST /v1/schedules/validate` validates the request and returns HTTP `501`.

The scheduling engine itself is intentionally not implemented yet.
