#!/usr/bin/env bash
set -euo pipefail

STAMP=$(date +"%Y%m%d-%H%M%S")
OUT="wnc-sql-handover-$STAMP"

mkdir -p "$OUT/local_sql"
mkdir -p "$OUT/live_schema"
mkdir -p "$OUT/manual_supabase_sql"
mkdir -p "$OUT/notes"

echo "Creating SQL handover folder: $OUT"

# 1. Copy all local SQL files from the project, preserving folder paths
find . \
  -path "./node_modules" -prune -o \
  -path "./.next" -prune -o \
  -path "./.git" -prune -o \
  -path "./$OUT" -prune -o \
  -name "*.sql" -type f -print | while read -r file; do
    clean_path="${file#./}"
    mkdir -p "$OUT/local_sql/$(dirname "$clean_path")"
    cp "$file" "$OUT/local_sql/$clean_path"
  done

# 2. Create an index of copied SQL files
find "$OUT/local_sql" -type f -name "*.sql" | sort > "$OUT/notes/local_sql_file_index.txt"

# 3. Try to dump the live Supabase public schema if Supabase CLI is available
if command -v supabase >/dev/null 2>&1; then
  echo "Supabase CLI found. Attempting live schema dump..."

  set +e
  supabase db dump --schema public --file "$OUT/live_schema/public_schema_current.sql"
  DUMP_STATUS=$?
  set -e

  if [ "$DUMP_STATUS" -ne 0 ]; then
    cat > "$OUT/live_schema/SUPABASE_DUMP_FAILED.txt" <<'EOF'
Supabase CLI dump failed.

This usually means the project is not linked locally or you are not logged in.

Try:
supabase login
supabase link --project-ref shhihkyxsxospgwgaobm
supabase db dump --schema public --file live_schema/public_schema_current.sql

Or use pg_dump with the database connection string from Supabase.
EOF
  fi
else
  cat > "$OUT/live_schema/SUPABASE_CLI_NOT_FOUND.txt" <<'EOF'
Supabase CLI was not found on this machine, so the live schema was not dumped.

Install/login/link Supabase CLI or manually export SQL from Supabase.
EOF
fi

# 4. Add a README for the new chat
cat > "$OUT/README.md" <<'EOF'
# WNC SQL Handover

This zip contains SQL context for the WNC staff scheduling automation.

Important current architecture:
- Supabase = source of truth
- Vercel/Next.js = manager UI
- n8n = orchestration
- 00 = parent orchestrator
- 01 = Build Planning Context
- 02 = Availability Agent
- 03 = Planner Engine
- 05 = Save Draft Assignments
- 04 = Validate + Manager Review

Important status:
- 01 works.
- 02 works.
- 03 works technically and outputs draft_plan.
- 05 saves generated draft assignments into public.shift_assignments with assignment_lifecycle = 'draft'.
- Supabase triggers were patched so draft assignments bypass strict publish validation.
- Published/non-draft assignments should still be strictly validated.
- 04 validates the draft and writes metadata.manager_review into public.schedule_generation_runs.
- The UI can show draft assignment rows, but the planning logic in 03 still needs improvement.

Key run:
generation_run_id = 009f2524-4406-41f2-a9d4-a3b2a2946146
period_id = 7f722af2-4c3d-4d09-bcbb-5fa2c7c094bc

Reset run SQL:

update public.schedule_generation_runs
set
  status = 'queued',
  current_stage = 'queued',
  completed_at = null,
  failed_at = null,
  failure_message = null,
  metadata = '{}'::jsonb,
  updated_at = now()
where id = '009f2524-4406-41f2-a9d4-a3b2a2946146'::uuid
returning
  id as generation_run_id,
  period_id,
  status,
  current_stage,
  started_at,
  completed_at,
  failed_at,
  failure_message,
  metadata,
  updated_at;

Current main issue:
The pipeline works, but 03 Generate Draft Plan has weak planning logic:
- Lilly is sometimes overused.
- Haylin/Sabine/Caterina are sometimes under target.
- Planner does not prioritize consecutive/grouped working days enough.
- Planner creates fragmented work patterns.
- Weekend avoidance is good, but full-weekend exceptions should be suggested as manager asks, not auto-assigned.
- Patrick should be wildcard/fill-in suggestion unless added as active staff in Supabase.

Next task:
Fix n8n Workflow 03 → Generate Draft Plan directly with JavaScript code.
Do not use Codex for n8n code unless explicitly editing local app files.
EOF

# 5. Add manual note for Supabase SQL Editor scripts
cat > "$OUT/manual_supabase_sql/README.md" <<'EOF'
If some SQL scripts only exist in Supabase SQL Editor saved queries, they may not appear as local files.

Supabase saved SQL Editor scripts are not the same as database schema and may need to be copied manually from the dashboard.

For the new chat, the most important thing is:
1. local_sql folder
2. live_schema/public_schema_current.sql if available
3. README.md
4. Any manually copied Supabase SQL scripts pasted into this manual_supabase_sql folder

Important scripts to include manually if missing:
001-009
017-020
any save_draft_assignments function
any shift_assignments draft lifecycle patch
any trigger patch for draft assignments
EOF

# 6. Zip it
zip -r "$OUT.zip" "$OUT" >/dev/null

echo ""
echo "Done."
echo "Created:"
echo "$PWD/$OUT.zip"
echo ""
echo "Upload this zip in the new chat."
