import assert from "node:assert/strict";
import test from "node:test";
import { buildScheduleCreatorViewModel } from "./schedule";
import type { SchedulePeriodRow, ScheduleGenerationRunRow, ShiftRow, ShiftAssignmentRow } from "../supabase/types";

const period: SchedulePeriodRow = { id: "period", name: "August 2026", start_date: "2026-08-01", end_date: "2026-08-31", availability_deadline: null, monthly_staff_budget_eur: 1000, status: "drafting", published_at: null, created_by: null, created_at: "", updated_at: "" };
const shift: ShiftRow = { id: "morning", period_id: period.id, shift_date: "2026-08-03", shift_type: "morning", start_time: "09:00", end_time: "17:00", required_count: 1, is_optional: false, notes: null, created_at: "", updated_at: "" };
const assignment: ShiftAssignmentRow = { id: "saved", shift_id: shift.id, staff_id: "original", status: "assigned", lifecycle: "draft", generation_run_id: null, assigned_by: null, assigned_at: null, manager_note: null, created_at: "", updated_at: "" };
const run: ScheduleGenerationRunRow = { id: "preview", period_id: period.id, status: "completed", initiated_by: "manager", started_at: "", completed_at: "", failed_at: null, failure_message: null, current_stage: "completed", metadata: { preview_kind: "flexible", comparison: { standard_gaps: 1, flexible_gaps: 0, staff: [] }, preview_result: { engine_version: "0.9.0", draft_assignments: [{ shift_id: shift.id, staff_member_id: "alternative" }, { shift_id: "new-day", staff_id: "alternative" }], proposed_shifts: [{ id: "new-day", shift_date: "2026-08-03", shift_type: "day", required_count: 0 }] } }, created_at: "", updated_at: "" };
const build = (generationRun = run) => buildScheduleCreatorViewModel({ selectedPeriod: period, activeStaff: [], submissions: [], contracts: [], trainingRows: [], shifts: [shift], assignments: [assignment], generationRuns: [generationRun], validationIssues: [], coverageRows: [], contractRows: [] });
const allShifts = (weeks: ReturnType<typeof build>["weeks"]) => weeks.flatMap(week => week.shiftsByDate).flatMap(day => day.shifts);

test("flexible calendar uses isolated proposed assignments without changing the saved draft", () => {
  const before = JSON.stringify({ shift, assignment, run });
  const model = build();
  assert.equal(allShifts(model.weeks).find(item => item.id === "morning")?.assignments[0].staffId, "original");
  assert.equal(allShifts(model.flexiblePreview!.weeks).find(item => item.id === "morning")?.assignments[0].staffId, "alternative");
  assert.equal(JSON.stringify({ shift, assignment, run }), before);
});

test("optional shifts proposed by the engine appear only in the preview calendar", () => {
  const model = build();
  assert.equal(allShifts(model.weeks).some(item => item.id === "new-day"), false);
  const proposed = allShifts(model.flexiblePreview!.weeks).find(item => item.id === "new-day");
  assert.equal(proposed?.shiftType, "day");
  assert.equal(proposed?.assignments[0].staffId, "alternative");
});

test("unfinished or failed runs cannot expose a completed preview", () => {
  for (const status of ["queued", "failed"] as const) {
    const model = build({ ...run, status });
    assert.equal(model.flexiblePreview, null);
    assert.equal(model.previewGeneration?.status, status);
    assert.equal(allShifts(model.weeks)[0].assignments[0].staffId, "original");
  }
});

test("previews generated under obsolete staffing rules are not offered for adoption", () => {
  const stale = JSON.parse(JSON.stringify(run));
  stale.metadata.preview_result.engine_version = "0.8.0";
  assert.equal(build(stale).flexiblePreview, null);
});
