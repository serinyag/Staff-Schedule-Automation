import assert from "node:assert/strict";
import test from "node:test";
import { buildScheduleAttention, reviewDate } from "./schedule-attention";

const shifts = [
  { id: "morning", shift_date: "2026-08-15", shift_type: "morning" },
  { id: "evening", shift_date: "2026-08-15", shift_type: "evening" },
];
const staff = [{ id: "lilly", full_name: "Lilly", is_active: true }];
const assignments = [{ shift_id: "morning", staff_id: "lilly" }];
const coverage = { severity: "error", code: "mandatory_shift_uncovered", shift_id: "evening", message: "Mandatory service coverage is below the required count.", details: { required_count: 1, valid_assignment_count: 0 } };
const base = { issues: [coverage], metadata: {}, shifts, staff, assignments, budget: 1000, cost: 900 };
const availability = [{ staff_id: "lilly", available_date: "2026-08-15", evening: true }];

test("single available staff already assigned gets a specific explanation and safe suggestion", () => {
  const { items } = buildScheduleAttention({ ...base, context: { availability_days: availability } });
  assert.equal(items.length, 1);
  assert.equal(items[0].title, "Sat 15 Aug · Evening");
  assert.equal(items[0].label, "Needs 1 staff");
  assert.equal(items[0].explanation, "Only Lilly is available and already works that morning.");
  assert.match(items[0].nextStep, /check whether Patrick can fill in/);
  assert.equal(items[0].shiftId, "evening");
  assert.equal(items[0].destination, "availability");
});

test("missing context does not claim everyone is unavailable", () => {
  for (const context of [undefined, {}, { training: [] }]) {
    assert.equal(buildScheduleAttention({ ...base, context }).items[0].explanation, "There is not enough staff coverage for this shift.");
  }
  assert.match(buildScheduleAttention({ ...base, context: { availability_days: [] } }).items[0].explanation, /No staff have submitted/);
});

test("trainee-only coverage explains the need for support", () => {
  const result = buildScheduleAttention({ ...base, assignments: [], context: { availability_days: availability, training: [{ staff_id: "lilly", phase: "phase_1_shadow_only" }] } });
  assert.match(result.items[0].explanation, /needs a trained colleague/);
});

test("budget appears only for a known current overrun", () => {
  for (const cost of [null, 900, 1000]) assert.equal(buildScheduleAttention({ ...base, issues: [], cost }).items.length, 0);
  const item = buildScheduleAttention({ ...base, issues: [], cost: 1549 }).items[0];
  assert.equal(item.label, "€549.00 over budget");
  assert.equal(item.destination, "budget");
});

test("old generation findings are discarded after assignments or availability change", () => {
  const metadata = { draft_assignments: assignments, availability_revision: 2, validation: { errors: [coverage] } };
  const input = { ...base, issues: [], metadata, availabilityRevision: 2 };
  assert.equal(buildScheduleAttention(input).items.length, 1);
  assert.equal(buildScheduleAttention({ ...input, availabilityRevision: 3 }).items.length, 0);
  assert.equal(buildScheduleAttention({ ...input, assignments: [] }).items.length, 0);
  assert.equal(buildScheduleAttention({ ...input, availabilityRevision: undefined }).items.length, 0);
});

test("generated and live coverage for the same shift produce one card", () => {
  const metadata = { draft_assignments: assignments, availability_revision: 2, validation: { errors: [coverage] } };
  assert.equal(buildScheduleAttention({ ...base, metadata, availabilityRevision: 2 }).items.length, 1);
});

test("minimum, training, availability, rest and unknown findings retain useful actions", () => {
  const cases = [
    ["weekly_minimum_not_met", "Below weekly minimum", "staff"],
    ["training_missing", "Training support needed", "staff"],
    ["staff_unavailable", "Availability conflict", "availability"],
    ["rest_violation", "Assignment conflict", "calendar"],
    ["new_rule", "Needs review", "calendar"],
  ];
  for (const [code, label, destination] of cases) {
    const item = buildScheduleAttention({ ...base, issues: [{ severity: "block", code, message: "Please review — this finding", staff_id: "lilly" }] }).items[0];
    assert.equal(item.label, label);
    assert.equal(item.destination, destination);
    assert.ok(item.nextStep.length > 0);
    assert.ok(!item.explanation.includes("—"));
  }
});

test("warnings remain separate and invalid dates do not crash the panel", () => {
  const result = buildScheduleAttention({ ...base, issues: [{ severity: "warning", message: "Preference not met" }] });
  assert.equal(result.items.length, 0);
  assert.deepEqual(result.warnings, ["Preference not met"]);
  assert.equal(reviewDate("2026-99-99"), "");
});
