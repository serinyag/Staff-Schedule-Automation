import type { TrainingPhase } from "../supabase/types";

export type StaffTrainingFormField =
  | "trainingPhase"
  | "openingTraining"
  | "openingTrainingCompletedOn"
  | "closingTraining"
  | "closingTrainingCompletedOn";

export type StaffTrainingFormInput = {
  hasTrainingRecord: boolean;
  trainingPhase: TrainingPhase | null;
  openingTrainingCompleted: boolean;
  openingTrainingCompletedOn: string;
  closingTrainingCompleted: boolean;
  closingTrainingCompletedOn: string;
};

export type StaffTrainingDateResolutionInput = {
  completed: boolean;
  requestedDate: string;
  existingDate: string;
  fallbackDate: string;
};

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDateString(value: string) {
  return ISO_DATE_PATTERN.test(value);
}

export function normalizeOptionalIsoDate(value: string) {
  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  return isIsoDateString(trimmed) ? trimmed : null;
}

export function resolveTrainingCompletionDate({
  completed,
  requestedDate,
  existingDate,
  fallbackDate,
}: StaffTrainingDateResolutionInput) {
  if (!completed) {
    return null;
  }

  return (
    normalizeOptionalIsoDate(requestedDate) ??
    normalizeOptionalIsoDate(existingDate) ??
    fallbackDate
  );
}

export function validateStaffTrainingForm({
  hasTrainingRecord,
  trainingPhase,
  openingTrainingCompleted,
  openingTrainingCompletedOn,
  closingTrainingCompleted,
  closingTrainingCompletedOn,
}: StaffTrainingFormInput) {
  const fieldErrors: Partial<Record<StaffTrainingFormField, string>> = {};

  if (!hasTrainingRecord || trainingPhase === null) {
    return fieldErrors;
  }

  const openingDate = openingTrainingCompletedOn.trim();
  const closingDate = closingTrainingCompletedOn.trim();

  if (openingDate && !isIsoDateString(openingDate)) {
    fieldErrors.openingTrainingCompletedOn = "Use YYYY-MM-DD for the opening training date.";
  }

  if (closingDate && !isIsoDateString(closingDate)) {
    fieldErrors.closingTrainingCompletedOn = "Use YYYY-MM-DD for the closing training date.";
  }

  if (!openingTrainingCompleted && openingDate) {
    fieldErrors.openingTrainingCompletedOn =
      "Clear the date or mark opening training as completed.";
  }

  if (!closingTrainingCompleted && closingDate) {
    fieldErrors.closingTrainingCompletedOn =
      "Clear the date or mark closing training as completed.";
  }

  if (trainingPhase === "phase_2_opening_independent" && !openingTrainingCompleted) {
    fieldErrors.trainingPhase = "Phase 2 requires opening training.";
    fieldErrors.openingTraining = "Mark opening training completed to save Phase 2.";
  }

  if (trainingPhase === "phase_3_fully_trained") {
    if (!openingTrainingCompleted) {
      fieldErrors.trainingPhase = "Phase 3 requires opening and closing training.";
      fieldErrors.openingTraining = "Mark opening training completed to save Phase 3.";
    }

    if (!closingTrainingCompleted) {
      fieldErrors.trainingPhase = "Phase 3 requires opening and closing training.";
      fieldErrors.closingTraining = "Mark closing training completed to save Phase 3.";
    }
  }

  return fieldErrors;
}

export function buildTrainingRecordWarnings({
  trainingPhase,
  openingTrainingCompletedOn,
  closingTrainingCompletedOn,
}: {
  trainingPhase: TrainingPhase;
  openingTrainingCompletedOn: string | null;
  closingTrainingCompletedOn: string | null;
}) {
  const warnings: string[] = [];

  if (trainingPhase === "phase_2_opening_independent" && !openingTrainingCompletedOn) {
    warnings.push(
      "This staff member is in Phase 2, but the opening training completion date is missing.",
    );
  }

  if (trainingPhase === "phase_3_fully_trained") {
    if (!openingTrainingCompletedOn) {
      warnings.push(
        "This staff member is in Phase 3, but the opening training completion date is missing.",
      );
    }

    if (!closingTrainingCompletedOn) {
      warnings.push(
        "This staff member is in Phase 3, but the closing training completion date is missing.",
      );
    }
  }

  if (trainingPhase === "phase_1_shadow_only" && closingTrainingCompletedOn) {
    warnings.push(
      "This Phase 1 record still shows a closing training completion date. Review it before saving.",
    );
  }

  if (trainingPhase === "phase_1_shadow_only" && openingTrainingCompletedOn) {
    warnings.push(
      "This Phase 1 record still shows an opening training completion date. Review it before saving.",
    );
  }

  return warnings;
}
