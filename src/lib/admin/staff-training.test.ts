import test from "node:test";
import assert from "node:assert/strict";
import {
  buildTrainingRecordWarnings,
  deriveTrainingCompletionState,
  resolveTrainingCompletionDate,
  validateStaffTrainingForm,
} from "./staff-training";

test("Phase 1 can be saved without training completions", () => {
  const fieldErrors = validateStaffTrainingForm({
    hasTrainingRecord: true,
    trainingPhase: "phase_1_shadow_only",
    openingTrainingCompleted: false,
    openingTrainingCompletedOn: "",
    closingTrainingCompleted: false,
    closingTrainingCompletedOn: "",
  });

  assert.deepEqual(fieldErrors, {});
});

test("Phase-derived completion state is automatic for Phase 1", () => {
  assert.deepEqual(deriveTrainingCompletionState("phase_1_shadow_only"), {
    openingTrainingCompleted: false,
    closingTrainingCompleted: false,
  });
});

test("Phase-derived completion state is automatic for Phase 2", () => {
  assert.deepEqual(deriveTrainingCompletionState("phase_2_opening_independent"), {
    openingTrainingCompleted: true,
    closingTrainingCompleted: false,
  });
});

test("Phase-derived completion state is automatic for Phase 3", () => {
  assert.deepEqual(deriveTrainingCompletionState("phase_3_fully_trained"), {
    openingTrainingCompleted: true,
    closingTrainingCompleted: true,
  });
});

test("Phase 2 can be saved without manual opening toggle input", () => {
  const fieldErrors = validateStaffTrainingForm({
    hasTrainingRecord: true,
    trainingPhase: "phase_2_opening_independent",
    openingTrainingCompleted: false,
    openingTrainingCompletedOn: "",
    closingTrainingCompleted: false,
    closingTrainingCompletedOn: "",
  });

  assert.deepEqual(fieldErrors, {});
});

test("Phase 3 can be saved without manual completion toggles", () => {
  const fieldErrors = validateStaffTrainingForm({
    hasTrainingRecord: true,
    trainingPhase: "phase_3_fully_trained",
    openingTrainingCompleted: false,
    openingTrainingCompletedOn: "",
    closingTrainingCompleted: false,
    closingTrainingCompletedOn: "",
  });

  assert.deepEqual(fieldErrors, {});
});

test("Existing training completion dates are preserved", () => {
  const openingDate = resolveTrainingCompletionDate({
    completed: true,
    requestedDate: "",
    existingDate: "2026-07-01",
    fallbackDate: "2026-07-15",
  });
  const closingDate = resolveTrainingCompletionDate({
    completed: true,
    requestedDate: "",
    existingDate: "2026-07-10",
    fallbackDate: "2026-07-15",
  });

  assert.equal(openingDate, "2026-07-01");
  assert.equal(closingDate, "2026-07-10");
});

test("Re-saving a completed training step keeps the same resolved date", () => {
  const firstSave = resolveTrainingCompletionDate({
    completed: true,
    requestedDate: "",
    existingDate: "2026-07-03",
    fallbackDate: "2026-07-15",
  });
  const secondSave = resolveTrainingCompletionDate({
    completed: true,
    requestedDate: "",
    existingDate: firstSave ?? "",
    fallbackDate: "2026-07-16",
  });

  assert.equal(secondSave, "2026-07-03");
});

test("Removing closing completion while retaining Phase 3 is now allowed because phase drives status", () => {
  const fieldErrors = validateStaffTrainingForm({
    hasTrainingRecord: true,
    trainingPhase: "phase_3_fully_trained",
    openingTrainingCompleted: true,
    openingTrainingCompletedOn: "2026-07-10",
    closingTrainingCompleted: false,
    closingTrainingCompletedOn: "",
  });

  assert.deepEqual(fieldErrors, {});
});

test("Downgrading from Phase 3 to Phase 2 while removing closing completion succeeds", () => {
  const fieldErrors = validateStaffTrainingForm({
    hasTrainingRecord: true,
    trainingPhase: "phase_2_opening_independent",
    openingTrainingCompleted: true,
    openingTrainingCompletedOn: "2026-07-10",
    closingTrainingCompleted: false,
    closingTrainingCompletedOn: "",
  });

  assert.deepEqual(fieldErrors, {});
});

test("Legacy inconsistencies produce warnings instead of crashing", () => {
  const warnings = buildTrainingRecordWarnings({
    trainingPhase: "phase_3_fully_trained",
    openingTrainingCompletedOn: null,
    closingTrainingCompletedOn: null,
  });

  assert.equal(warnings.length, 2);
});
