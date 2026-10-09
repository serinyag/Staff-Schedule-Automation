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


test("coverage notices only flag morning and evening, while retaining day assignment conflicts", () => {
  const result = buildScheduleAttention({ ...base, shifts: [...shifts, { id: "day", shift_date: "2026-08-15", shift_type: "day", is_optional: true }], issues: [
    coverage,
    { ...coverage, shift_id: "morning" },
    { ...coverage, shift_id: "day" },
    { severity: "block", message: "day shift on 2026-08-16 is short by 1 staff member(s)" },
    { severity: "block", shift_id: "day", code: "rest_violation", message: "Required rest is not met." },
  ] });
  assert.deepEqual(result.items.map(item => [item.shiftId, item.label]), [
    ["evening", "Needs 1 staff"], ["morning", "Needs 1 staff"], ["day", "Assignment conflict"],
  ]);
});


test("weekend conflicts identify the person, both shifts and exact review actions", () => {
  const weekendShifts = [
    { id: "sat", shift_date: "2026-08-08", shift_type: "morning" },
    { id: "sun", shift_date: "2026-08-09", shift_type: "evening" },
  ];
  const result = buildScheduleAttention({ ...base, staff: [{ id: "cat", full_name: "Caterina" }], shifts: weekendShifts,
    assignments: weekendShifts.map(s => ({ shift_id: s.id, staff_id: "cat" })),
    issues: [{ severity: "block", staff_id: "cat", code: "role_full_weekend_blocked", week_start: "2026-08-03", message: "This role may not be scheduled for both Saturday and Sunday of the same weekend" }],
  });
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].title, "Caterina · Sat 8 Aug / Sun 9 Aug");
  assert.match(result.items[0].explanation, /Sat 8 Aug morning and Sun 9 Aug evening/);
  assert.match(result.items[0].nextStep, /Reassign either Caterina’s Saturday shift or Sunday shift/);
  assert.deepEqual(result.items[0].relatedShifts?.map(s => s.id), ["sat", "sun"]);
});

test("anonymous weekend notices resolve only staff with a saved weekend restriction", () => {
  const weekendShifts = [{ id: "sat", shift_date: "2026-08-08", shift_type: "morning" }, { id: "sun", shift_date: "2026-08-09", shift_type: "evening" }];
  const people = [{ id: "cat", full_name: "Caterina", scheduling_rule_role: "core_team" }, { id: "lilly", full_name: "Lilly", scheduling_rule_role: "host" }];
  const result = buildScheduleAttention({ ...base, shifts: weekendShifts, staff: people,
    assignments: people.flatMap(p => weekendShifts.map(s => ({ shift_id: s.id, staff_id: p.id }))),
    context: { role_rules: [{ scheduling_rule_role: "core_team", raw: { block_full_weekend: true } }] },
    issues: [1,2].map(() => ({ severity: "block", message: "This role may not be scheduled for both Saturday and Sunday of the same weekend" })),
  });
  assert.equal(result.items.length, 1);
  assert.match(result.items[0].title, /Caterina/);
});

test("weekly shortfalls explain available days and the weekend capacity restriction", () => {
  const check = (dates: string[], minimum: number, weekend: boolean) => buildScheduleAttention({
    ...base, staff: [{ ...staff[0], scheduling_rule_role: "core_team" }],
    issues: [{ severity: "block", code: "weekly_minimum_not_met", staff_id: "lilly", week_start: "2026-08-10", details: { min_shifts_per_week: minimum, assigned_shift_count: 1 } }],
    context: { availability_days: dates.map(available_date => ({ staff_id: "lilly", available_date, morning: true })), role_rules: [{ scheduling_rule_role: "core_team", rule_config: { block_full_weekend: weekend } }] },
  }).items[0];
  assert.match(check(["2026-08-10"], 2, false).explanation, /only on Mon 10 Aug.*at most 1 shift/);
  assert.match(check(["2026-08-10", "2026-08-15", "2026-08-16"], 3, true).explanation, /only one day per weekend.*at most 2 shifts/);
  assert.match(check(["2026-08-10", "2026-08-15", "2026-08-16"], 3, true).nextStep, /happy to work both Saturday and Sunday.*explicit exception/);
  assert.doesNotMatch(check(["2026-08-10"], 2, false).nextStep, /both Saturday and Sunday/);
  assert.match(check([], 2, false).explanation, /no available days recorded/);
  assert.match(check(["2026-08-10", "2026-08-15", "2026-08-16"], 3, false).explanation, /Availability alone does not explain/);
  assert.equal(check(["2026-08-10"], 2, false).destination, "availability");
});
