#!/usr/bin/env bash
set -euo pipefail
# Only an ephemeral Docker database is touched. No published/live schedules.
container="staff-runtime-test-${RANDOM}"
trap 'docker rm -f "$container" >/dev/null 2>&1 || true' EXIT
docker run --name "$container" -e POSTGRES_PASSWORD=local-test-only -d postgres:17 >/dev/null
for attempt in {1..30}; do
  if docker exec "$container" pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1; then break; fi
  sleep 1
done
for source in supabase/tests/fixtures/runtime_database.sql supabase/migrations/029_production_schedule_runtime.sql supabase/tests/production_schedule_runtime.sql; do
  docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 < "$source"
done
