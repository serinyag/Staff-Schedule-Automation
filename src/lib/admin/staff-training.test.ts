import test from "node:test";
import assert from "node:assert/strict";
import {
  buildTrainingRecordWarnings,
  resolveTrainingCompletionDate,
  validateStaffTrainingForm,
} from "./staff-training.ts";

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

test("Phase 2 cannot be saved without opening training", () => {
  const fieldErrors = validateStaffTrainingForm({
    hasTrainingRecord: true,
    trainingPhase: "phase_2_opening_independent",
    openingTrainingCompleted: false,
    openingTrainingCompletedOn: "",
    closingTrainingCompleted: false,
    closingTrainingCompletedOn: "",
  });

  assert.equal(fieldErrors.trainingPhase, "Phase 2 requires opening training.");
  assert.equal(fieldErrors.openingTraining, "Mark opening training completed to save Phase 2.");
});

test("Phase 2 can be saved when opening training is completed in the same request", () => {
  const fieldErrors = validateStaffTrainingForm({
    hasTrainingRecord: true,
    trainingPhase: "phase_2_opening_independent",
    openingTrainingCompleted: true,
    openingTrainingCompletedOn: "2026-07-15",
    closingTrainingCompleted: false,
    closingTrainingCompletedOn: "",
  });

  assert.deepEqual(fieldErrors, {});
});

test("Phase 3 cannot be saved without opening training", () => {
  const fieldErrors = validateStaffTrainingForm({
    hasTrainingRecord: true,
    trainingPhase: "phase_3_fully_trained",
    openingTrainingCompleted: false,
    openingTrainingCompletedOn: "",
    closingTrainingCompleted: true,
    closingTrainingCompletedOn: "2026-07-15",
  });

  assert.equal(
    fieldErrors.openingTraining,
    "Mark opening training completed to save Phase 3.",
  );
});

test("Phase 3 cannot be saved without closing training", () => {
  const fieldErrors = validateStaffTrainingForm({
    hasTrainingRecord: true,
    trainingPhase: "phase_3_fully_trained",
    openingTrainingCompleted: true,
    openingTrainingCompletedOn: "2026-07-15",
    closingTrainingCompleted: false,
    closingTrainingCompletedOn: "",
  });

  assert.equal(
    fieldErrors.closingTraining,
    "Mark closing training completed to save Phase 3.",
  );
});

test("Phase 3 can be saved when both completions are recorded in the same request", () => {
  const fieldErrors = validateStaffTrainingForm({
    hasTrainingRecord: true,
    trainingPhase: "phase_3_fully_trained",
    openingTrainingCompleted: true,
    openingTrainingCompletedOn: "2026-07-15",
    closingTrainingCompleted: true,
    closingTrainingCompletedOn: "2026-07-15",
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

test("Removing closing completion while retaining Phase 3 is rejected", () => {
  const fieldErrors = validateStaffTrainingForm({
    hasTrainingRecord: true,
    trainingPhase: "phase_3_fully_trained",
    openingTrainingCompleted: true,
    openingTrainingCompletedOn: "2026-07-10",
    closingTrainingCompleted: false,
    closingTrainingCompletedOn: "",
  });

  assert.equal(
    fieldErrors.closingTraining,
    "Mark closing training completed to save Phase 3.",
  );
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
